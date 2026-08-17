import type React from 'react';
import { cn } from '../../utils/cn';

interface AppPageProps extends React.HTMLAttributes<HTMLElement> {
  children: React.ReactNode;
  className?: string;
}

export const AppPage: React.FC<AppPageProps> = ({ children, className = '', ...props }) => {
  return (
    <main className={cn('mx-auto min-h-full w-full max-w-[1540px] px-4 pb-14 pt-5 md:px-7 md:pt-7 xl:px-10', className)} {...props}>
      {children}
    </main>
  );
};
