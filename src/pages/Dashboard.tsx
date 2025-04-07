import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { LogOut, Plus, X, Check, Loader2, Trash2 } from 'lucide-react';

interface Task {
  description: string;
  hours: string;
}

interface Project {
  name: string;
  tasks: Task[];
}

export const Dashboard = () => {
  const { signOut, session } = useAuth();
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  const addProject = () => {
    setProjects([...projects, { name: '', tasks: [{ description: '', hours: '' }] }]);
  };

  const addTask = (projectIndex: number) => {
    const newProjects = [...projects];
    newProjects[projectIndex].tasks.push({ description: '', hours: '' });
    setProjects(newProjects);
  };

  const removeProject = (projectIndex: number) => {
    setProjects(projects.filter((_, index) => index !== projectIndex));
  };

  const removeTask = (projectIndex: number, taskIndex: number) => {
    const newProjects = [...projects];
    newProjects[projectIndex].tasks = newProjects[projectIndex].tasks.filter(
      (_, index) => index !== taskIndex
    );
    setProjects(newProjects);
  };

  const updateProject = (index: number, name: string) => {
    const newProjects = [...projects];
    newProjects[index].name = name;
    setProjects(newProjects);
  };

  const updateTask = (projectIndex: number, taskIndex: number, field: keyof Task, value: string) => {
    const newProjects = [...projects];
    newProjects[projectIndex].tasks[taskIndex][field] = value;
    setProjects(newProjects);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (projects.length === 0) {
      setError('Please add at least one project');
      return;
    }

    setSubmitting(true);
    setError('');
    setSuccessMessage('');

    try {
      const entries = projects.flatMap(project => 
        project.tasks.map(task => ({
          date,
          project: project.name,
          description: task.description,
          hours: task.hours,
          userEmail: session?.user.email,
        }))
      );

      for (const entry of entries) {
        const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/timesheet`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(entry),
        });

        if (!response.ok) {
          throw new Error('Failed to save timesheet entry');
        }
      }

      setSuccessMessage('Timesheet entries saved successfully!');
      setProjects([]);
      setDate(new Date().toISOString().split('T')[0]);
    } catch (error: any) {
      setError(error.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center">
              <h1 className="text-xl font-semibold text-gray-900">Timesheet Entry</h1>
            </div>
            <div className="flex items-center">
              <span className="text-gray-700 mr-4">{session?.user.email}</span>
              <button
                onClick={() => signOut()}
                className="inline-flex items-center px-3 py-2 border border-transparent text-sm leading-4 font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
              >
                <LogOut className="h-4 w-4 mr-2" />
                Sign out
              </button>
            </div>
          </div>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          {successMessage && (
            <div className="mb-4 p-4 bg-green-100 border border-green-400 text-green-700 rounded">
              {successMessage}
            </div>
          )}

          {error && (
            <div className="mb-4 p-4 bg-red-100 border border-red-400 text-red-700 rounded">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="bg-white shadow sm:rounded-lg">
              <div className="px-4 py-5 sm:p-6">
                <div className="mb-6">
                  <label htmlFor="date" className="block text-sm font-medium text-gray-700">
                    Date
                  </label>
                  <input
                    type="date"
                    id="date"
                    required
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                  />
                </div>

                {projects.map((project, projectIndex) => (
                  <div key={projectIndex} className="mb-8 p-4 border border-gray-200 rounded-lg">
                    <div className="flex items-center justify-between mb-4">
                      <input
                        type="text"
                        placeholder="Project Name"
                        required
                        value={project.name}
                        onChange={(e) => updateProject(projectIndex, e.target.value)}
                        className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                      />
                      <button
                        type="button"
                        onClick={() => removeProject(projectIndex)}
                        className="ml-2 p-1 text-red-600 hover:text-red-900 focus:outline-none"
                      >
                        <Trash2 className="h-5 w-5" />
                      </button>
                    </div>

                    <div className="space-y-4">
                      {project.tasks.map((task, taskIndex) => (
                        <div key={taskIndex} className="flex items-start space-x-4">
                          <div className="flex-grow">
                            <input
                              type="text"
                              placeholder="Task Description"
                              required
                              value={task.description}
                              onChange={(e) => updateTask(projectIndex, taskIndex, 'description', e.target.value)}
                              className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                            />
                          </div>
                          <div className="w-24">
                            <input
                              type="number"
                              placeholder="Hours"
                              required
                              min="0.5"
                              max="24"
                              step="0.5"
                              value={task.hours}
                              onChange={(e) => updateTask(projectIndex, taskIndex, 'hours', e.target.value)}
                              className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                            />
                          </div>
                          <button
                            type="button"
                            onClick={() => removeTask(projectIndex, taskIndex)}
                            className="p-1 text-red-600 hover:text-red-900 focus:outline-none"
                          >
                            <Trash2 className="h-5 w-5" />
                          </button>
                        </div>
                      ))}
                    </div>

                    <button
                      type="button"
                      onClick={() => addTask(projectIndex)}
                      className="mt-4 inline-flex items-center px-3 py-2 border border-gray-300 shadow-sm text-sm leading-4 font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                    >
                      <Plus className="h-4 w-4 mr-2" />
                      Add Task
                    </button>
                  </div>
                ))}

                <button
                  type="button"
                  onClick={addProject}
                  className="inline-flex items-center px-4 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add Project
                </button>

                <div className="mt-6 flex justify-end">
                  <button
                    type="submit"
                    disabled={submitting || projects.length === 0}
                    className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
                  >
                    {submitting ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Check className="h-4 w-4 mr-2" />
                    )}
                    Submit Timesheet
                  </button>
                </div>
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};