interface ServiceBadgeProps {
  service: string
}

export function ServiceBadge({ service }: ServiceBadgeProps) {
  return <span className="service-badge">{service}</span>
}
