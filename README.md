## Google Drive & Sheets Setup Instructions

1. **Create a Parent Folder in Google Drive**
   - Go to [Google Drive](https://drive.google.com)
   - Create a new folder (e.g., "Employee Timesheets")
   - Copy the folder ID from the URL (it's the string after /folders/)

2. **Set up Google Cloud Project**
   - Go to [Google Cloud Console](https://console.cloud.google.com)
   - Create a new project
   - Enable both the Google Sheets API and Google Drive API for your project
   - Go to "APIs & Services" > "Credentials"
   - Click "Create Credentials" > "Service Account"
   - Fill in the service account details
   - Once created, click on the service account
   - Go to "Keys" tab > "Add Key" > "Create New Key"
   - Choose JSON format and download the key file

3. **Share Parent Folder**
   - Open your Google Drive folder
   - Click "Share"
   - Add the service account email (ends with @project-id.iam.gserviceaccount.com)
   - Give "Editor" access

4. **Configure Supabase Environment Variables**
   Add these environment variables to your Supabase project:

   ```
   GOOGLE_DRIVE_FOLDER_ID=your-folder-id
   GOOGLE_CLIENT_EMAIL=service-account-email
   GOOGLE_PRIVATE_KEY=private-key-from-json
   ```

Note: The private key should include the entire key including "-----BEGIN PRIVATE KEY-----" and "-----END PRIVATE KEY-----"

## How it Works

- When an employee submits their first timesheet entry, a new Google Spreadsheet is automatically created in the parent folder
- The spreadsheet is named "Timesheet - employee@email.com"
- The spreadsheet contains 12 sheets, one for each month
- Each sheet has headers: Date, Hours, Project, Description
- Entries are automatically added to the appropriate month's sheet based on the entry date
- All spreadsheets are organized in the parent folder for easy access and management