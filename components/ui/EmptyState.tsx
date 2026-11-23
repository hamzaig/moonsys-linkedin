import type { ReactNode } from "react";
import { RiInboxLine } from "react-icons/ri";

export default function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return <div className="ms-empty-state">
    <span className="ms-empty-icon" aria-hidden="true"><RiInboxLine size={24} /></span>
    <h3>{title}</h3>{description && <p>{description}</p>}{action && <div className="mt-4">{action}</div>}
  </div>;
}
