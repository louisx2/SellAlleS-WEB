import type { FC, ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  children?: ReactNode;
}

export const PageHeader: FC<PageHeaderProps> = ({ title, children }) => {
  return (
    <div className="flex items-center justify-between mb-6">
      <h1 className="text-3xl font-bold tracking-tight font-headline text-gray-800">{title}</h1>
      {children && <div className="ml-4">{children}</div>}
    </div>
  );
};
