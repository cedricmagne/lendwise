'use client'

import type { ReactNode } from 'react'

import { Label, Pie, PieChart } from 'recharts'

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart'
import { useCurrency } from '@/contexts'
import { formatCompactCurrency } from '@/lib/format-currency'

import { PieChartDonutTextEmpty } from './PieChartDonutTextEmpty'

export interface PieChartDonutTextProps {
  title?: ReactNode
  description?: ReactNode
  config: ChartConfig
  data: {
    id: string
    label: string
    value: number
    percent?: number
    fill: string
  }[]
  footerTitle?: ReactNode
  footerDescription?: ReactNode
}

export function PieChartDonutText({
  title,
  description,
  config,
  data,
  footerTitle,
  footerDescription,
}: PieChartDonutTextProps) {
  const { baseCurrency } = useCurrency()
  const total = data.reduce((acc, val) => acc + val.value, 0)

  return (
    <Card className="flex flex-col">
      <CardHeader className="items-center pb-0">
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex-1 pb-0">
        {!data.length ? (
          <PieChartDonutTextEmpty />
        ) : (
          <div className="grid h-full grid-cols-2">
            <div>
              <ChartContainer
                config={config}
                className="mx-auto aspect-square max-h-62.5"
              >
                <PieChart>
                  <ChartTooltip
                    cursor={false}
                    content={<ChartTooltipContent hideLabel />}
                  />
                  <Pie
                    data={data}
                    dataKey="value"
                    nameKey="label"
                    innerRadius={60}
                    strokeWidth={5}
                    paddingAngle={data.length === 1 ? 0 : 3}
                  >
                    <Label
                      content={({ viewBox }) => {
                        if (viewBox && 'cx' in viewBox && 'cy' in viewBox) {
                          return (
                            <text
                              x={viewBox.cx}
                              y={viewBox.cy}
                              textAnchor="middle"
                              dominantBaseline="middle"
                            >
                              <tspan
                                x={viewBox.cx}
                                y={viewBox.cy}
                                className="fill-foreground text-sm font-bold"
                              >
                                {formatCompactCurrency(total, baseCurrency)}
                              </tspan>
                              <tspan
                                x={viewBox.cx}
                                y={(viewBox.cy || 0) + 24}
                                className="fill-muted-foreground text-xs font-bold"
                              >
                                {baseCurrency}
                              </tspan>
                            </text>
                          )
                        }
                      }}
                    />
                  </Pie>
                </PieChart>
              </ChartContainer>
            </div>
            <div className="flex h-full w-11/12 flex-col items-center justify-center space-y-2">
              {data.map((item) => (
                <div
                  key={item.id}
                  className="flex w-full items-center justify-between text-sm"
                >
                  <div className="flex items-center gap-2">
                    <div
                      className="h-3 w-3 rounded-full"
                      style={{
                        backgroundColor: config[item.id].color,
                      }}
                    />
                    <span className="text-muted-foreground-300">
                      {item.label}
                    </span>
                  </div>
                  <span className="text-foreground font-medium">
                    {item.percent?.toFixed(2)}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
      <CardFooter className="flex-col gap-2 text-sm">
        <div className="flex items-center gap-2 leading-none font-medium">
          {footerTitle}
        </div>
        <div className="text-muted-foreground leading-none">
          {footerDescription}
        </div>
      </CardFooter>
    </Card>
  )
}
