import { google } from 'npm:googleapis@131.0.0';

// Updated CORS headers with more comprehensive configuration
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Max-Age': '86400',
  'Access-Control-Allow-Credentials': 'true'
};

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

// Initialize Google APIs with proper error handling
const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: Deno.env.get('GOOGLE_CLIENT_EMAIL'),
    private_key: Deno.env.get('GOOGLE_PRIVATE_KEY')?.replace(/\\n/g, '\n'),
  },
  scopes: [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive'
  ]
});

const sheets = google.sheets({ version: 'v4', auth });
const drive = google.drive({ version: 'v3', auth });

async function sendSlackAlert(userEmail: string, userName: string, date: string) {
  try {
    const SLACK_WEBHOOK_URL = Deno.env.get('SLACK_WEBHOOK_URL');
    if (!SLACK_WEBHOOK_URL) {
      console.error('SLACK_WEBHOOK_URL is not set');
      return;
    }

    const currentDate = new Date().toISOString().split('T')[0];
    
    const message = {
      blocks: [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: '🚨 Past Date Timesheet Submission Alert',
            emoji: true
          }
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `• *Employee:* ${userName} (${userEmail})\n• *Submitted for Date:* ${date}\n• *Submission Date:* ${currentDate}`
          }
        }
      ],
      text: `Past date timesheet submission by ${userName}`, // Fallback text
    };

    console.log('Sending Slack alert:', JSON.stringify(message));

    const response = await fetch(SLACK_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(message)
    });

    if (!response.ok) {
      throw new Error(`Failed to send Slack notification: ${response.statusText}`);
    }

    console.log('Slack alert sent successfully');
  } catch (error) {
    console.error('Error sending Slack notification:', error);
    // Don't throw the error to prevent blocking the timesheet submission
  }
}

async function findOrCreateSpreadsheet(userEmail: string): Promise<string> {
  const fileName = `Timesheet - ${userEmail}`;
  const folderId = Deno.env.get('GOOGLE_DRIVE_FOLDER_ID');

  if (!folderId) {
    throw new Error('GOOGLE_DRIVE_FOLDER_ID environment variable is not set');
  }

  try {
    // Search for existing spreadsheet
    const response = await drive.files.list({
      q: `name = '${fileName}' and '${folderId}' in parents and mimeType = 'application/vnd.google-apps.spreadsheet'`,
      fields: 'files(id, name)',
    });

    if (response.data.files && response.data.files.length > 0) {
      return response.data.files[0].id;
    }

    // Create new spreadsheet
    const createResponse = await drive.files.create({
      requestBody: {
        name: fileName,
        mimeType: 'application/vnd.google-apps.spreadsheet',
        parents: [folderId],
      },
      fields: 'id',
    });

    const spreadsheetId = createResponse.data.id;

    // Initialize sheets for each month
    for (let i = 0; i < MONTHS.length; i++) {
      if (i === 0) {
        // Rename default sheet
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: {
            requests: [{
              updateSheetProperties: {
                properties: {
                  sheetId: 0,
                  title: MONTHS[0],
                },
                fields: 'title',
              },
            }],
          },
        });
      } else {
        // Add new sheet
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: {
            requests: [{
              addSheet: {
                properties: {
                  title: MONTHS[i],
                },
              },
            }],
          },
        });
      }

      // Add headers
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${MONTHS[i]}!A1:D1`,
        valueInputOption: 'RAW',
        requestBody: {
          values: [['Date', 'Project', 'Task', 'Hours']],
        },
      });
    }

    return spreadsheetId;
  } catch (error) {
    console.error('Error in findOrCreateSpreadsheet:', error);
    throw new Error(`Failed to create or find spreadsheet: ${error.message}`);
  }
}

// Main function handler with improved error handling and CORS
Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders
    });
  }

  try {
    // Validate request method
    if (req.method !== 'POST') {
      throw new Error(`Method ${req.method} not allowed`);
    }

    const { date, hours, project, description, userEmail, userName } = await req.json();

    // Validate input
    if (!date || !hours || !project || !description || !userEmail) {
      throw new Error('Missing required fields');
    }

    console.log('Processing timesheet entry:', { date, userEmail, userName });

    // Validate environment variables
    const requiredEnvVars = ['GOOGLE_CLIENT_EMAIL', 'GOOGLE_PRIVATE_KEY', 'GOOGLE_DRIVE_FOLDER_ID'];
    for (const envVar of requiredEnvVars) {
      if (!Deno.env.get(envVar)) {
        throw new Error(`Missing required environment variable: ${envVar}`);
      }
    }

    // Get current date in IST
    const istOffset = 5.5 * 60 * 60 * 1000; // IST is UTC+5:30
    const now = new Date();
    const currentDateIST = new Date(now.getTime() + istOffset);
    
    // Convert submission date to IST
    const submittedDate = new Date(date);
    const submittedDateIST = new Date(submittedDate.getTime() + istOffset);

    // Reset time components for both dates
    currentDateIST.setHours(0, 0, 0, 0);
    submittedDateIST.setHours(0, 0, 0, 0);

    console.log('Date comparison:', {
      currentDateIST: currentDateIST.toISOString(),
      submittedDateIST: submittedDateIST.toISOString()
    });

    const spreadsheetId = await findOrCreateSpreadsheet(userEmail);
    const monthName = MONTHS[new Date(date).getMonth()];

    // Append entry
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${monthName}!A:D`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[date, project, description, hours]],
      },
    });

    // Send notification only for the first task in a past date submission
    if (submittedDateIST < currentDateIST && project === req.headers.get('X-First-Task')) {
      console.log('Past date detected, sending Slack alert');
      await sendSlackAlert(userEmail, userName || userEmail, date);
    }

    return new Response(
      JSON.stringify({ message: 'Timesheet entry saved successfully' }),
      {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      }
    );
  } catch (error) {
    console.error('Error processing request:', error);
    
    return new Response(
      JSON.stringify({
        error: 'Failed to save timesheet entry',
        details: error.message,
      }),
      {
        status: error.status || 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      }
    );
  }
});
