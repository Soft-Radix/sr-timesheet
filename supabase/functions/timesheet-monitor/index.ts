import { createClient } from 'npm:@supabase/supabase-js@2.39.7';
import { google } from 'npm:googleapis@131.0.0';

// Enhanced CORS headers with additional security headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Max-Age': '86400',
  'Access-Control-Allow-Credentials': 'true',
  'Vary': 'Origin'
};

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December'
];

// Enhanced environment variable validation
function getRequiredEnvVar(name: string): string {
  const value = Deno.env.get(name);
  if (!value) {
    throw new Error(`Required environment variable ${name} is not set`);
  }
  return value;
}

// Initialize Supabase client with enhanced error handling
const supabaseUrl = getRequiredEnvVar('SUPABASE_URL');
const supabaseServiceKey = getRequiredEnvVar('SUPABASE_SERVICE_ROLE_KEY');
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Initialize Google APIs with enhanced error handling
const googleClientEmail = getRequiredEnvVar('GOOGLE_CLIENT_EMAIL');
const googlePrivateKey = getRequiredEnvVar('GOOGLE_PRIVATE_KEY').replace(/\\n/g, '\n');

const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: googleClientEmail,
    private_key: googlePrivateKey
  },
  scopes: [
    'https://www.googleapis.com/auth/spreadsheets.readonly',
    'https://www.googleapis.com/auth/drive.metadata.readonly'
  ]
});

const sheets = google.sheets({
  version: 'v4',
  auth
});

const drive = google.drive({
  version: 'v3',
  auth
});

async function findSpreadsheet(userEmail: string) {
  try {
    const fileName = `Timesheet - ${userEmail}`;
    const response = await drive.files.list({
      q: `name = '${fileName}' and mimeType = 'application/vnd.google-apps.spreadsheet'`,
      fields: 'files(id)'
    });
    return response.data.files?.[0]?.id || null;
  } catch (error) {
    console.error('Error finding spreadsheet:', error);
    return null;
  }
}

async function getTimesheetEntries(spreadsheetId: string, date: string) {
  const monthName = MONTHS[new Date(date).getMonth()];
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${monthName}!A:D`
    });
    const rows = response.data.values || [];
    return rows
      .slice(1) // Skip header row
      .filter((row) => row[0] === date)
      .map((row) => ({
        date: row[0],
        project: row[1],
        description: row[2],
        hours: parseFloat(row[3]) || 0
      }));
  } catch (error) {
    console.error('Error fetching timesheet entries:', error);
    return [];
  }
}

async function getAllUsers() {
  try {
    let allUsers = [];
    let nextPage = null;
    do {
      const { data, error } = await supabase.auth.admin.listUsers({
        page: nextPage
      });
      if (error) throw error;
      allUsers = allUsers.concat(data.users);
      nextPage = data.nextPage;
    } while (nextPage);
    return allUsers;
  } catch (error) {
    console.error('Error fetching users:', error);
    throw error;
  }
}

async function sendSlackNotification(reports: any[]) {
  const SLACK_WEBHOOK_URL = getRequiredEnvVar('SLACK_WEBHOOK_URL');

  // Group reports by status
  const missingReports = reports.filter(r => r.status === 'missing');
  const incompleteReports = reports.filter(r => r.status === 'incomplete');

  const blocks = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: '📊 Daily Timesheet Report',
        emoji: true
      }
    },
    {
      type: 'divider'
    }
  ];

  // Add missing timesheet section if there are any
  if (missingReports.length > 0) {
    blocks.push(
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*People who didn\'t submit the timesheet*'
        }
      },
      ...missingReports.map(report => ({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `• ${report.user.user_metadata?.display_name || 'Unknown'} (${report.user.email})`
        }
      }))
    );
  }

  // Add divider if both sections will be present
  if (missingReports.length > 0 && incompleteReports.length > 0) {
    blocks.push({
      type: 'divider'
    });
  }

  // Add incomplete hours section if there are any
  if (incompleteReports.length > 0) {
    blocks.push(
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*People who didn\'t complete working hours*'
        }
      },
      ...incompleteReports.map(report => ({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `• ${report.user.user_metadata?.display_name || 'Unknown'} (${report.user.email}) - ${report.hoursLogged} hours logged`
        }
      }))
    );
  }

  try {
    const response = await fetch(SLACK_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ blocks })
    });

    if (!response.ok) {
      throw new Error(`Failed to send Slack notification: ${response.statusText}`);
    }
  } catch (error) {
    console.error('Error sending Slack notification:', error);
    throw error;
  }
}

async function checkTimesheets() {
  const today = new Date();
  
  // Skip weekends
  if (today.getDay() === 0 || today.getDay() === 6) {
    console.log('Skipping weekend check');
    return [];
  }

  const dateStr = today.toISOString().split('T')[0];
  
  try {
    const users = await getAllUsers();
    const reports = [];

    for (const user of users) {
      const spreadsheetId = await findSpreadsheet(user.email);
      if (!spreadsheetId) {
        reports.push({
          user,
          status: 'missing'
        });
        continue;
      }

      const entries = await getTimesheetEntries(spreadsheetId, dateStr);
      if (entries.length === 0) {
        reports.push({
          user,
          status: 'missing'
        });
        continue;
      }

      const totalHours = entries.reduce((sum, entry) => sum + entry.hours, 0);
      if (totalHours < 8) {
        reports.push({
          user,
          status: 'incomplete',
          hoursLogged: totalHours
        });
      }
    }

    if (reports.length > 0) {
      await sendSlackNotification(reports);
    }
    return reports;
  } catch (error) {
    console.error('Error in checkTimesheets:', error);
    throw error;
  }
}

// Enhanced request handling with proper CORS
Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders
    });
  }

  try {
    // Validate request method
    if (req.method !== 'GET' && req.method !== 'POST') {
      throw new Error(`Method ${req.method} not allowed`);
    }

    const reports = await checkTimesheets();
    return new Response(
      JSON.stringify({
        message: 'Timesheet check completed successfully',
        reports
      }),
      {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      }
    );
  } catch (error) {
    console.error('Error in edge function:', error);
    return new Response(
      JSON.stringify({
        error: 'Failed to check timesheets',
        details: error.message
      }),
      {
        status: error.status || 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      }
    );
  }
});
