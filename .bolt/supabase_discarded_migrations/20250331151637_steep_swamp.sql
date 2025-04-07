/*
  # Create timesheets table

  1. New Tables
    - `timesheets`
      - `id` (uuid, primary key)
      - `user_id` (uuid, references auth.users)
      - `date` (date)
      - `hours` (numeric)
      - `description` (text)
      - `project` (text)
      - `created_at` (timestamp)
      - `updated_at` (timestamp)

  2. Security
    - Enable RLS on `timesheets` table
    - Add policies for users to:
      - Create their own timesheet entries
      - Read their own timesheet entries
      - Update their own timesheet entries
      - Delete their own timesheet entries
*/

CREATE TABLE IF NOT EXISTS timesheets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) NOT NULL,
  date date NOT NULL,
  hours numeric(4,2) NOT NULL CHECK (hours > 0 AND hours <= 24),
  description text NOT NULL,
  project text NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE timesheets ENABLE ROW LEVEL SECURITY;

-- Policy for users to create their own timesheet entries
CREATE POLICY "Users can create their own timesheet entries"
  ON timesheets
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Policy for users to read their own timesheet entries
CREATE POLICY "Users can read their own timesheet entries"
  ON timesheets
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Policy for users to update their own timesheet entries
CREATE POLICY "Users can update their own timesheet entries"
  ON timesheets
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Policy for users to delete their own timesheet entries
CREATE POLICY "Users can delete their own timesheet entries"
  ON timesheets
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);