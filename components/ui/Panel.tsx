import type { HTMLAttributes, ReactNode } from "react";

export default function Panel({ children, className = "", ...props }: HTMLAttributes<HTMLElement>) {
  return <section {...props} className={`ms-panel ${className}`}>{children}</section>;
}

export function PanelHeading({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return <div className="ms-panel-heading"><div><h2>{title}</h2>{description && <p>{description}</p>}</div>{actions}</div>;
}
