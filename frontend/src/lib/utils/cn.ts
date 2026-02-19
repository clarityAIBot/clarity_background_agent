import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Format status for display - converts snake_case to Title Case with special handling
export function formatStatus(status: string): string {
  const statusMap: Record<string, string> = {
    'pr_created': 'PR Created',
    'completed': 'Completed',
    'error': 'Error',
    'cancelled': 'Cancelled',
    'pending': 'Pending',
    'processing': 'Processing',
    'in_progress': 'In Progress',
    'needs_clarification': 'Needs Clarification',
    'clarification_received': 'Clarification Received',
    'follow_up': 'Follow Up'
  };
  return statusMap[status] || status.split('_').map(word =>
    word.charAt(0).toUpperCase() + word.slice(1)
  ).join(' ');
}

// Format bytes to human-readable size
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}
