import type { HTMLAttributes, ReactNode } from "react";

export default function PageHeader({ children, className = "", ...props }: HTMLAttributes<HTMLElement>) {
  return <header {...props} className={`ms-page-header ${className}`}>{children}</header>;
}

export function PageTitle({ children, className = "", ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h1 {...props} className={`ms-page-title ${className}`}>{children}</h1>;
}

export function PageDescription({ children, className = "", ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p {...props} className={`ms-page-description ${className}`}>{children}</p>;
}

export function PageHeading({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return <PageHeader>
    <div className="min-w-0"><PageTitle>{title}</PageTitle>{description && <PageDescription>{description}</PageDescription>}</div>
    {actions && <div className="ms-page-actions">{actions}</div>}
  </PageHeader>;
}
