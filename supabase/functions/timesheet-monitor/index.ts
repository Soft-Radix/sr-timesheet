import { createClient } from 'npm:@supabase/supabase-js@2.39.7';
import { google } from 'npm:googleapis@131.0.0';

interface TimesheetEntry {
  date: string;
  project: string;
  description: string;
  hours: number;
}

interface UserReport {
  email: string;
  status: 'missing' | 'incomplete';
  hoursLogged?: number;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

// Initialize Supabase client
const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Initialize Google APIs
const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: Deno.env.get('GOOGLE_CLIENT_EMAIL'),
    private_key: Deno.env.get('GOOGLE_PRIVATE_KEY')?.replace(/\\n/g, '\n'),
  },
  scopes: [
    'https://www.googleapis.com/auth/spreadsheets.readonly',
    'https://www.googleapis.com/auth/drive.metadata.readonly'
  ],
});

const sheets = google.sheets({ version: 'v4', auth });
const drive = google.drive({ version: 'v3', auth });

async function findSpreadsheet(userEmail: string): Promise<string | null> {
  const fileName = `Timesheet - ${userEmail}`;
  const response = await drive.files.list({
    q: `name = '${fileName}' and mimeType = 'application/vnd.google-apps.spreadsheet'`,
    fields: 'files(id)',
  });

  return response.data.files?.[0]?.id || null;
}

async function getTimesheetEntries(spreadsheetId: string, date: string): Promise<TimesheetEntry[]> {
  const monthName = MONTHS[new Date(date).getMonth()];
  
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${monthName}!A:D`,
    });

    const rows = response.data.values || [];
    return rows.slice(1) // Skip header row
      .filter(row => row[0] === date)
      .map(row => ({
        date: row[0],
        project: row[1],
        description: row[2],
        hours: parseFloat(row[3]) || 0,
      }));
  } catch (error) {
    console.error('Error fetching timesheet entries:', error);
    return [];
  }
}

async function getAllUsers(): Promise<string[]> {
  const { data: users, error } = await supabase
    .from('auth.users')
    .select('email')
    .not('email', 'is', null);

  if (error) {
    console.error('Error fetching users:', error);
    throw error;
  }

  return users.map(user => user.email);
}

async function sendSlackNotification(reports: UserReport[]) {
  const SLACK_WEBHOOK_URL = Deno.env.get('SLACK_WEBHOOK_URL');
  if (!SLACK_WEBHOOK_URL) {
    throw new Error('SLACK_WEBHOOK_URL environment variable is not set');
  }

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
    },
    ...reports.map(report => ({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: report.status === 'missing'
          ? `⚠️ *${report.email}* has not submitted timesheet for today`
          : `⚠️ *${report.email}* has logged only ${report.hoursLogged} hours today (minimum required: 8 hours)`
      }
    }))
  ];

  try {
    const response = await fetch(SLACK_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
  const today = new Date().toISOString().split('T')[0];
  const users = await getAllUsers();
  const reports: UserReport[] = [];

  for (const userEmail of users) {
    const spreadsheetId = await findSpreadsheet(userEmail);
    if (!spreadsheetId) {
      reports.push({
        email: userEmail,
        status: 'missing'
      });
      continue;
    }

    const entries = await getTimesheetEntries(spreadsheetId, today);
    if (entries.length === 0) {
      reports.push({
        email: userEmail,
        status: 'missing'
      });
      continue;
    }

    const totalHours = entries.reduce((sum, entry) => sum + entry.hours, 0);
    if (totalHours < 8) {
      reports.push({
        email: userEmail,
        status: 'incomplete',
        hoursLogged: totalHours
      });
    }
  }

  if (reports.length > 0) {
    await sendSlackNotification(reports);
  }

  return reports;
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const reports = await checkTimesheets();
    
    return new Response(
      JSON.stringify({
        message: 'Timesheet check completed successfully',
        reports
      }),
      {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      }
    );
  } catch (error) {
    console.error('Error checking timesheets:', error);
    
    return new Response(
      JSON.stringify({
        error: 'Failed to check timesheets',
        details: error.message
      }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      }
    );
  }
});
