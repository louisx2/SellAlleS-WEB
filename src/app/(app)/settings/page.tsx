import { redirect } from 'next/navigation';

export default function SettingsPage() {
  // Redirect to the first settings page by default
  redirect('/users');
}
