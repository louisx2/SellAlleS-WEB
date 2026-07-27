'use client';

import { useTheme } from 'next-themes';
import { Button } from '@/components/ui/button';
import { Sun, Moon } from 'lucide-react';

export function AuthThemeToggle() {
  const { theme, setTheme } = useTheme();

  const handleThemeChange = () => {
    const newTheme = theme === 'dark' ? 'light' : 'dark';
    if (!document.startViewTransition) {
      setTheme(newTheme);
      return;
    }
    document.startViewTransition(() => {
      setTheme(newTheme);
    });
  };

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="absolute right-4 top-4 z-10"
      aria-label="Cambiar tema"
      onClick={handleThemeChange}
    >
      {theme === 'dark' ? (
        <Sun className="h-5 w-5 text-orange-500" />
      ) : (
        <Moon className="h-5 w-5 text-muted-foreground" />
      )}
    </Button>
  );
}
