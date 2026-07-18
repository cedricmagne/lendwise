'use client'

interface PieChartMiniProps {
  percentage: number
  color?: string
  backgroundColor?: string
  size?: number
  strokeWidth?: number
  showLabel?: boolean
  labelColor?: string
  labelSize?: 'sm' | 'md' | 'lg'
}

export function PieChartMini({
  percentage,
  color = 'var(--chart-1)',
  backgroundColor = 'var(--muted-foreground)',
  size = 17,
  strokeWidth = 5,
  showLabel = true,
  labelColor = 'var(--foreground)',
  labelSize = 'sm',
}: PieChartMiniProps) {
  const labelSizeMap = {
    sm: 'text-2xs',
    md: 'text-xs',
    lg: 'text-sm',
  }

  // Calculate circle properties for SVG
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const strokeDashoffset = circumference - (percentage / 100) * circumference

  return (
    <div className="flex items-center justify-center gap-1">
      <div
        className="relative inline-flex shrink-0 items-center justify-center"
        style={{ width: size, height: size }}
      >
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          className="-rotate-90 transform"
        >
          {/* Background circle */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={backgroundColor}
            strokeWidth={strokeWidth}
          />
          {/* Progress circle */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={strokeWidth}
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            className="transition-all duration-300 ease-in-out"
          />
        </svg>
      </div>
      {showLabel && (
        <div
          className={`pointer-events-none flex min-w-[7ch] items-center justify-start font-semibold tabular-nums ${labelSizeMap[labelSize]}`}
          style={{ color: labelColor }}
        >
          {percentage < 0.1 ? '<0.1' : percentage.toFixed(2)}%
        </div>
      )}
    </div>
  )
}
