import { google } from 'npm:googleapis@131.0.0';
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
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
// Validate environment variables
const GOOGLE_CLIENT_EMAIL = Deno.env.get('GOOGLE_CLIENT_EMAIL');
const GOOGLE_PRIVATE_KEY = Deno.env.get('GOOGLE_PRIVATE_KEY');
const PARENT_FOLDER_ID = Deno.env.get('GOOGLE_DRIVE_FOLDER_ID');
if (!GOOGLE_CLIENT_EMAIL || !GOOGLE_PRIVATE_KEY || !PARENT_FOLDER_ID) {
  console.error('Missing required environment variables:', {
    hasClientEmail: !!GOOGLE_CLIENT_EMAIL,
    hasPrivateKey: !!GOOGLE_PRIVATE_KEY,
    hasParentFolderId: !!PARENT_FOLDER_ID
  });
  throw new Error('Missing required environment variables');
}
// Initialize Google APIs
const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: GOOGLE_CLIENT_EMAIL,
    private_key: GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n')
  },
  scopes: [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive'
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
async function verifyFolderAccess(folderId) {
  try {
    let folders = [];
    let pageToken = undefined;
    do {
      const res = await drive.files.list({
        q: "mimeType='application/vnd.google-apps.folder'",
        fields: 'nextPageToken, files(id, name)',
        pageSize: 1000,
        pageToken
      });
      if (res.data.files) {
        folders = folders.concat(res.data.files);
      }
      pageToken = res.data.nextPageToken;
    }while (pageToken)
    console.log("allfolders", JSON.stringify(folders));
    const response = await drive.files.get({
      fileId: folderId,
      fields: 'id, name, mimeType'
    });
    if (response.data.mimeType !== 'application/vnd.google-apps.folder') {
      throw new Error('Provided ID is not a folder');
    }
    console.log('Successfully verified folder access:', {
      id: response.data.id,
      name: response.data.name
    });
    return true;
  } catch (error) {
    console.error('Failed to verify folder access:', {
      error: error.message,
      response: error.response?.data
    });
    throw new Error(`Failed to access folder: ${error.message}`);
  }
}
async function createFolder() {
  const authClient = await auth.getClient();
  const drive = google.drive({
    version: 'v3',
    auth: authClient
  });
  const res = await drive.files.create({
    requestBody: {
      name: 'Timesheet Folder',
      mimeType: 'application/vnd.google-apps.folder'
    },
    fields: 'id, name'
  });
  console.log('✅ Folder created:', res.data);
}
async function getOrCreateEmployeeSpreadsheet(userEmail) {
  await createFolder();
  // First verify folder access
  await verifyFolderAccess(PARENT_FOLDER_ID);
  const fileName = `Timesheet - ${userEmail}`;
  try {
    // Search for existing spreadsheet
    const response = await drive.files.list({
      q: `name = '${fileName}' and '${PARENT_FOLDER_ID}' in parents and mimeType = 'application/vnd.google-apps.spreadsheet'`,
      fields: 'files(id, name)'
    });
    console.log('Search results:', {
      query: `name = '${fileName}' and '${PARENT_FOLDER_ID}' in parents`,
      results: response.data.files
    });
    let spreadsheetId;
    if (response.data.files && response.data.files.length > 0) {
      // Use existing spreadsheet
      spreadsheetId = response.data.files[0].id;
      console.log('Found existing spreadsheet:', spreadsheetId);
    } else {
      // Create new spreadsheet
      console.log('Creating new spreadsheet for:', userEmail);
      const createResponse = await drive.files.create({
        requestBody: {
          name: fileName,
          mimeType: 'application/vnd.google-apps.spreadsheet',
          parents: [
            PARENT_FOLDER_ID
          ]
        },
        fields: 'id'
      });
      spreadsheetId = createResponse.data.id;
      console.log('Created new spreadsheet:', spreadsheetId);
      // Create 12 sheets for months
      for(let i = 0; i < MONTHS.length; i++){
        if (i === 0) {
          // Rename the default sheet
          await sheets.spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: {
              requests: [
                {
                  updateSheetProperties: {
                    properties: {
                      sheetId: 0,
                      title: MONTHS[0]
                    },
                    fields: 'title'
                  }
                }
              ]
            }
          });
        } else {
          // Add new sheets for remaining months
          await sheets.spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: {
              requests: [
                {
                  addSheet: {
                    properties: {
                      title: MONTHS[i]
                    }
                  }
                }
              ]
            }
          });
        }
        // Add headers to each sheet
        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: `${MONTHS[i]}!A1:D1`,
          valueInputOption: 'RAW',
          requestBody: {
            values: [
              [
                'Date',
                'Project',
                'Task',
                'Hours'
              ]
            ]
          }
        });
      }
      console.log('Created new spreadsheet with monthly sheets:', spreadsheetId);
    }
    return spreadsheetId;
  } catch (error) {
    console.error('Error in getOrCreateEmployeeSpreadsheet:', {
      error: error.message,
      response: error.response?.data,
      stack: error.stack
    });
    throw error;
  }
}
Deno.serve(async (req)=>{
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: corsHeaders
    });
  }
  try {
    console.log('Request received:', req.method);
    const body = await req.json();
    console.log('Request body:', JSON.stringify(body, null, 2));
    const { date, hours, project, description, userEmail } = body;
    // Validate required fields
    if (!date || !hours || !project || !description || !userEmail) {
      console.error('Missing required fields:', {
        date,
        hours,
        project,
        description,
        userEmail
      });
      throw new Error('Missing required fields');
    }
    // Get or create employee's spreadsheet
    const spreadsheetId = await getOrCreateEmployeeSpreadsheet(userEmail);
    // Determine which month's sheet to use
    const entryDate = new Date(date);
    const monthName = MONTHS[entryDate.getMonth()];
    console.log('Appending to sheet:', monthName);
    // Append data to the appropriate month's sheet
    const response = await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${monthName}!A:D`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [
          [
            date,
            project,
            description,
            hours
          ]
        ]
      }
    });
    console.log('Google Sheets API Response:', JSON.stringify(response.data, null, 2));
    return new Response(JSON.stringify({
      message: 'Timesheet entry saved successfully'
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('Detailed Error:', {
      message: error.message,
      stack: error.stack,
      cause: error.cause,
      name: error.name
    });
    if (error.response) {
      console.error('Google API Error:', {
        status: error.response.status,
        statusText: error.response.statusText,
        data: error.response.data
      });
    }
    return new Response(JSON.stringify({
      error: 'Failed to save timesheet entry',
      details: error.message,
      cause: error.response?.data || 'Unknown error'
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
});
