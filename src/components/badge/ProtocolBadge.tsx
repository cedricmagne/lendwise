import { ProtocolIcon } from '@/components/icon'
import { Badge } from '@/components/ui/badge'
import { protocolVersionName } from '@/config/protocols-meta'

export function ProtocolBadge({ protocol }: { protocol: string }) {
  return (
    <Badge
      variant="outline"
      className="flex w-fit items-center gap-2 rounded-lg px-2 py-1.5 whitespace-nowrap"
    >
      <ProtocolIcon protocol={protocol} />
      <span className="text-muted-foreground text-xs whitespace-nowrap">
        {protocolVersionName(protocol)}
      </span>
    </Badge>
  )
}
