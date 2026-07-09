import type { Metadata } from 'next'

import { BookOpen, Mail, MessageCircle } from 'lucide-react'

import { Card, CardContent } from '@/components/ui/card'

export const metadata: Metadata = {
  title: 'Support - Lendwise',
  description:
    'Get help with Lendwise — reach us by email, on X, or browse the documentation.',
}

const channels = [
  {
    title: 'Email Us',
    description: 'support@lendwise.fi',
    href: 'mailto:support@lendwise.fi',
    icon: Mail,
    external: false,
  },
  {
    title: 'Message us on X',
    description: '@lendwisefi — DMs are open',
    href: 'https://x.com/lendwisefi',
    icon: MessageCircle,
    external: true,
  },
  {
    title: 'Read the Docs',
    description: 'Guides, data methodology, and GraphQL API reference',
    href: '/docs',
    icon: BookOpen,
    external: false,
  },
]

export default function SupportPage() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-6 py-16">
      <div className="text-center">
        <h1 className="text-3xl font-semibold tracking-tight">Support</h1>
        <p className="text-muted-foreground mt-2">
          Questions, bug reports, or feedback — we read everything
        </p>
      </div>

      <div className="flex flex-col gap-4">
        {channels.map((channel) => (
          <a
            key={channel.title}
            href={channel.href}
            target={channel.external ? '_blank' : undefined}
            rel={channel.external ? 'noopener noreferrer' : undefined}
          >
            <Card className="hover:border-primary/50 hover:bg-secondary/50 transition-colors">
              <CardContent className="flex flex-col items-center gap-1 py-6 text-center">
                <div className="flex items-center gap-2">
                  <channel.icon className="text-primary h-5 w-5" />
                  <span className="text-lg font-semibold">{channel.title}</span>
                </div>
                <p className="text-muted-foreground text-sm">
                  {channel.description}
                </p>
              </CardContent>
            </Card>
          </a>
        ))}
      </div>

      <p className="text-muted-foreground text-center text-sm">
        Email and X DMs get the fastest response — usually within 24 hours.
      </p>
    </div>
  )
}
