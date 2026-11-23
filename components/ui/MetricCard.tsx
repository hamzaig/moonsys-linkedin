import type { CSSProperties, ReactNode } from "react";

export default function MetricCard({ label, value, description, icon, color }: {
  label: string; value: ReactNode; description?: ReactNode; icon?: ReactNode; color: string;
}) {
  return <section className="ms-metric" aria-label={label} style={{ "--metric-color": color } as CSSProperties}>
    <div className="ms-metric-top"><span className="ms-metric-label">{label}</span>{icon && <span className="ms-metric-icon" aria-hidden="true">{icon}</span>}</div>
    <div className="ms-metric-value">{value}</div>
    {description && <div className="ms-metric-description">{description}</div>}
  </section>;
}
