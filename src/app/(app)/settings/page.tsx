'use client'

import { Suspense, useEffect, useState } from 'react'

import { useRouter, useSearchParams } from 'next/navigation'

import { ConnectButton } from '@rainbow-me/rainbowkit'
import {
  AlertTriangle,
  CheckCircle,
  Clock,
  Globe,
  Key,
  LogOutIcon,
  Mail,
  Monitor,
  Moon,
  Settings2,
  Shield,
  Smartphone,
  Sun,
  User,
  Wallet,
} from 'lucide-react'
import { toast } from 'sonner'
import { Address } from 'viem'
import { useAccount, useDisconnect } from 'wagmi'

import { BlockchainSelector } from '@/components/blockchain-selector'
import { TokenIcon } from '@/components/icon/TokenIcon'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { WalletAvatar } from '@/components/wallet'
import { CHAINS } from '@/config/chains'
import {
  SUPPORTED_CURRENCIES,
  formatCurrencyDisplay,
} from '@/config/currencies'
import { useCurrency } from '@/contexts'
import { useMultiWalletManager } from '@/hooks/useMultiWalletManager'
import { formatAddress } from '@/lib/utils'
import { useWalletStore } from '@/stores/walletStore'

interface User {
  id: string
  name: string
  email: string
  image?: string | null
}

interface OrderItem {
  label: string
  amount: number
}

interface Order {
  id: string
  product?: {
    name: string
  }
  createdAt: string
  totalAmount: number
  currency: string
  status: string
  subscription?: {
    status: string
    endedAt?: string
  }
  items: OrderItem[]
}

interface OrdersResponse {
  result: {
    items: Order[]
  }
}

function SettingsContent() {
  const [user] = useState<User | null>(null)
  const [orders] = useState<OrdersResponse | null>(null)
  const [loading] = useState(false)
  const [currentTab, setCurrentTab] = useState('general')
  const router = useRouter()
  const searchParams = useSearchParams()
  const { address: activeAddress } = useAccount()
  const { disconnect } = useDisconnect()
  const { baseCurrency, setBaseCurrency } = useCurrency()
  const { disconnectAddress } = useMultiWalletManager()
  const { wallets } = useWalletStore()

  // Settings states
  const [theme, setTheme] = useState<'light' | 'dark' | 'system'>('system')
  const [language, setLanguage] = useState('en')
  const [selectedChains, setSelectedChains] = useState<number[]>([])
  const [emailNotifications, setEmailNotifications] = useState({
    priceAlerts: true,
    positionUpdates: true,
    weeklyReports: false,
    marketingEmails: false,
  })
  const [pushNotifications, setPushNotifications] = useState({
    priceAlerts: true,
    liquidations: true,
    opportunities: false,
  })
  const [privacySettings, setPrivacySettings] = useState({
    showPortfolio: false,
    allowAnalytics: true,
    dataSharing: false,
  })

  // Profile form states
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')

  // Profile picture upload states
  const [, setProfileImage] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)

  // Handle URL tab parameter
  useEffect(() => {
    const tab = searchParams.get('tab')
    if (
      tab &&
      ['general', 'networks', 'accounts', 'notifications', 'billing'].includes(
        tab
      )
    ) {
      setCurrentTab(tab)
    }
  }, [searchParams])

  const handleTabChange = (value: string) => {
    setCurrentTab(value)
    const url = new URL(window.location.href)
    url.searchParams.set('tab', value)
    router.replace(url.pathname + url.search, { scroll: false })
  }

  const handleUpdateProfile = async () => {
    try {
      toast.success('Profile updated successfully')
    } catch {
      toast.error('Failed to update profile')
    }
  }

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setProfileImage(file)
      const reader = new FileReader()
      reader.onloadend = () => {
        setImagePreview(reader.result as string)
      }
      reader.readAsDataURL(file)
    }
  }

  const handleDisconnectWallet = async (walletAddress: string) => {
    try {
      const isActiveAddress =
        walletAddress.toLowerCase() === activeAddress?.toLowerCase()
      const isLastAddress = wallets.length === 1

      // Remove from our store
      disconnectAddress(walletAddress as Address)

      // If this is the active address or the last address, disconnect from wagmi
      if (isActiveAddress || isLastAddress) {
        disconnect()
      }

      toast.success('Wallet disconnected')
    } catch (error) {
      console.error('Failed to disconnect wallet:', error)
      toast.error('Failed to disconnect wallet')
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-6 p-6">
        {/* Header Skeleton */}
        <div>
          <Skeleton className="bg-muted mb-2 h-9 w-32" />
          <Skeleton className="bg-muted h-5 w-80" />
        </div>

        {/* Tabs Skeleton */}
        <div className="w-full max-w-4xl">
          <div className="mb-6 flex space-x-1">
            <Skeleton className="bg-muted h-10 w-20" />
            <Skeleton className="bg-muted h-10 w-28" />
            <Skeleton className="bg-muted h-10 w-16" />
          </div>

          <div className="space-y-6">
            {/* Profile Information Card Skeleton */}
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Skeleton className="bg-muted h-5 w-5 rounded" />
                  <Skeleton className="bg-muted h-6 w-40" />
                </div>
                <Skeleton className="bg-muted h-4 w-72" />
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="flex items-center gap-4">
                  <Skeleton className="bg-muted h-20 w-20 rounded-full" />
                  <div className="space-y-2">
                    <div className="flex gap-2">
                      <Skeleton className="bg-muted h-8 w-24" />
                      <Skeleton className="bg-muted h-8 w-12" />
                      <Skeleton className="bg-muted h-8 w-16" />
                    </div>
                    <Skeleton className="bg-muted h-4 w-48" />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Skeleton className="bg-muted h-4 w-20" />
                    <Skeleton className="bg-muted h-10 w-full" />
                  </div>
                  <div className="space-y-2">
                    <Skeleton className="bg-muted h-4 w-12" />
                    <Skeleton className="bg-muted h-10 w-full" />
                  </div>
                </div>

                <Skeleton className="bg-muted h-10 w-28" />
              </CardContent>
            </Card>

            {/* Change Password Card Skeleton */}
            <Card>
              <CardHeader>
                <Skeleton className="bg-muted h-6 w-36" />
                <Skeleton className="bg-muted h-4 w-64" />
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Skeleton className="bg-muted h-4 w-32" />
                  <Skeleton className="bg-muted h-10 w-full" />
                </div>
                <div className="space-y-2">
                  <Skeleton className="bg-muted h-4 w-28" />
                  <Skeleton className="bg-muted h-10 w-full" />
                </div>
                <div className="space-y-2">
                  <Skeleton className="bg-muted h-4 w-40" />
                  <Skeleton className="bg-muted h-10 w-full" />
                </div>
                <Skeleton className="bg-muted h-10 w-32" />
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Settings</h1>
        <p className="text-muted-foreground mt-2">
          Manage your account settings and preferences
        </p>
      </div>

      <Tabs
        value={currentTab}
        onValueChange={handleTabChange}
        className="w-full max-w-4xl"
      >
        <TabsList>
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="networks">Networks</TabsTrigger>
          <TabsTrigger value="accounts">Accounts</TabsTrigger>
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
          <TabsTrigger value="billing">Billing</TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="space-y-6">
          {/* Profile Information */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <User className="h-5 w-5" />
                Profile Information
              </CardTitle>
              <CardDescription>
                Update your personal information and profile settings
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center gap-4">
                <Avatar className="h-20 w-20">
                  <AvatarImage src={imagePreview || user?.image || ''} />
                  <AvatarFallback>
                    {name
                      .split(' ')
                      .map((n) => n[0])
                      .join('')}
                  </AvatarFallback>
                </Avatar>
                <div className="space-y-2">
                  <div className="flex gap-2">
                    {imagePreview && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setImagePreview(null)
                          setProfileImage(null)
                        }}
                      >
                        Cancel
                      </Button>
                    )}
                  </div>
                  <input
                    id="profile-image-input"
                    type="file"
                    accept="image/*"
                    onChange={handleImageChange}
                    className="hidden"
                  />
                  <p className="text-muted-foreground text-sm">
                    JPG, GIF or PNG. 1MB max.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Full Name</Label>
                  <Input
                    id="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Enter your full name"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Enter your email"
                    disabled
                  />
                </div>
              </div>

              <Button onClick={handleUpdateProfile}>Save Changes</Button>
            </CardContent>
          </Card>

          {/* Appearance */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Monitor className="h-5 w-5" />
                Appearance
              </CardTitle>
              <CardDescription>
                Customize how the application looks and feels
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <Label>Theme</Label>
                <Select
                  value={theme}
                  onValueChange={(value: 'light' | 'dark' | 'system') =>
                    setTheme(value)
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="light">
                      <div className="flex items-center gap-2">
                        <Sun className="h-4 w-4" />
                        Light
                      </div>
                    </SelectItem>
                    <SelectItem value="dark">
                      <div className="flex items-center gap-2">
                        <Moon className="h-4 w-4" />
                        Dark
                      </div>
                    </SelectItem>
                    <SelectItem value="system">
                      <div className="flex items-center gap-2">
                        <Monitor className="h-4 w-4" />
                        System
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Language</Label>
                <Select value={language} onValueChange={setLanguage}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="en">English</SelectItem>
                    <SelectItem value="es">Español</SelectItem>
                    <SelectItem value="fr">Français</SelectItem>
                    <SelectItem value="de">Deutsch</SelectItem>
                    <SelectItem value="zh">中文</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Currency</Label>
                <Select value={baseCurrency} onValueChange={setBaseCurrency}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SUPPORTED_CURRENCIES.map((currency) => (
                      <SelectItem key={currency.code} value={currency.code}>
                        <div className="flex items-center gap-2">
                          <TokenIcon symbol={currency.code} size={16} />
                          {formatCurrencyDisplay(currency)}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {/* Security */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5" />
                Security
              </CardTitle>
              <CardDescription>
                Manage your account security and privacy settings
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Two-Factor Authentication</Label>
                    <p className="text-muted-foreground text-sm">
                      Add an extra layer of security to your account
                    </p>
                  </div>
                  <Button variant="outline" size="sm">
                    <Key className="mr-2 h-4 w-4" />
                    Enable 2FA
                  </Button>
                </div>

                <Separator />

                <div className="space-y-4">
                  <Label>Privacy Settings</Label>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <Label className="text-sm">
                          Show Portfolio Publicly
                        </Label>
                        <p className="text-muted-foreground text-xs">
                          Allow others to view your DeFi positions
                        </p>
                      </div>
                      <Switch
                        checked={privacySettings.showPortfolio}
                        onCheckedChange={(checked) =>
                          setPrivacySettings((prev) => ({
                            ...prev,
                            showPortfolio: checked,
                          }))
                        }
                      />
                    </div>

                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <Label className="text-sm">Analytics</Label>
                        <p className="text-muted-foreground text-xs">
                          Help improve the platform with anonymous usage data
                        </p>
                      </div>
                      <Switch
                        checked={privacySettings.allowAnalytics}
                        onCheckedChange={(checked) =>
                          setPrivacySettings((prev) => ({
                            ...prev,
                            allowAnalytics: checked,
                          }))
                        }
                      />
                    </div>

                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <Label className="text-sm">Data Sharing</Label>
                        <p className="text-muted-foreground text-xs">
                          Share anonymized data with partners
                        </p>
                      </div>
                      <Switch
                        checked={privacySettings.dataSharing}
                        onCheckedChange={(checked) =>
                          setPrivacySettings((prev) => ({
                            ...prev,
                            dataSharing: checked,
                          }))
                        }
                      />
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="networks" className="space-y-6">
          {/* Default Networks */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Globe className="h-5 w-5" />
                Default Networks
              </CardTitle>
              <CardDescription>
                Choose which blockchain networks to display by default
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <Label>Preferred Networks</Label>
                <BlockchainSelector
                  selectedChains={selectedChains}
                  onChainsChange={setSelectedChains}
                  showTestnets={false}
                />
                <p className="text-muted-foreground text-sm">
                  Selected networks will be prioritized in the dashboard and
                  analytics
                </p>
              </div>
            </CardContent>
          </Card>

          {/* RPC Configuration */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Settings2 className="h-5 w-5" />
                RPC Configuration
              </CardTitle>
              <CardDescription>
                Configure custom RPC endpoints for better performance
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-4">
                {CHAINS.MAINNETS.slice(0, 3).map((chain) => (
                  <div key={chain.id} className="space-y-2">
                    <Label>{chain.name}</Label>
                    <Input
                      placeholder={`https://mainnet.infura.io/v3/...`}
                      defaultValue={chain.rpc}
                    />
                  </div>
                ))}
              </div>
              <Button variant="outline">Save RPC Settings</Button>
            </CardContent>
          </Card>

          {/* Network Alerts */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5" />
                Network Alerts
              </CardTitle>
              <CardDescription>
                Configure alerts for network status and performance
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Network Downtime Alerts</Label>
                  <p className="text-muted-foreground text-sm">
                    Get notified when networks experience issues
                  </p>
                </div>
                <Switch defaultChecked />
              </div>

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>High Gas Fee Warnings</Label>
                  <p className="text-muted-foreground text-sm">
                    Alert when gas fees exceed normal levels
                  </p>
                </div>
                <Switch defaultChecked />
              </div>

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Network Congestion Alerts</Label>
                  <p className="text-muted-foreground text-sm">
                    Get notified about network congestion
                  </p>
                </div>
                <Switch />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="accounts" className="space-y-6">
          {/* Connected Wallets */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Wallet className="h-5 w-5" />
                Connected Wallets
              </CardTitle>
              <CardDescription>
                Manage your connected wallet addresses
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {(() => {
                const { wallets } = useWalletStore()
                const connectedWallets = wallets.filter((w) => w.isConnected)

                if (connectedWallets.length === 0) {
                  return (
                    <div className="py-8 text-center">
                      <Wallet className="text-muted-foreground mx-auto mb-4 h-12 w-12" />
                      <h3 className="mb-2 text-lg font-semibold">
                        No wallets connected
                      </h3>
                      <p className="text-muted-foreground mb-4">
                        Connect your wallet to manage your DeFi positions
                      </p>
                      <ConnectButton.Custom>
                        {({ openConnectModal, mounted }) => {
                          if (!mounted) return null
                          return (
                            <Button onClick={openConnectModal}>
                              Connect Wallet
                            </Button>
                          )
                        }}
                      </ConnectButton.Custom>
                    </div>
                  )
                }

                return (
                  <div className="space-y-4">
                    {connectedWallets.map((wallet) => (
                      <div
                        key={wallet.address}
                        className="flex items-center justify-between rounded-lg border p-4"
                      >
                        <div className="flex items-center gap-3">
                          <WalletAvatar address={wallet.address} />
                          <div>
                            <div className="font-medium">
                              {wallet.ens || formatAddress(wallet.address)}
                            </div>
                            <div className="text-muted-foreground text-sm">
                              {wallet.address}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {wallet.isActive && (
                            <Badge variant="outline" className="text-green-600">
                              <CheckCircle className="mr-1 h-3 w-3" />
                              Active
                            </Badge>
                          )}
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              handleDisconnectWallet(wallet.address)
                            }
                          >
                            <span>Disconnect</span>
                            <LogOutIcon />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )
              })()}
            </CardContent>
          </Card>

          {/* Account Security */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5" />
                Account Security
              </CardTitle>
              <CardDescription>
                Monitor and manage your account security
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Login Activity</Label>
                    <p className="text-muted-foreground text-sm">
                      Last login: 2 hours ago from Chrome on macOS
                    </p>
                  </div>
                  <Button variant="outline" size="sm">
                    View Details
                  </Button>
                </div>

                <Separator />

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Active Sessions</Label>
                    <p className="text-muted-foreground text-sm">
                      3 active sessions across devices
                    </p>
                  </div>
                  <Button variant="outline" size="sm">
                    Manage Sessions
                  </Button>
                </div>

                <Separator />

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Recovery Phrase</Label>
                    <p className="text-muted-foreground text-sm">
                      Backup your wallet recovery phrase
                    </p>
                  </div>
                  <Button variant="outline" size="sm">
                    Backup
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="notifications" className="space-y-6">
          {/* Email Notifications */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Mail className="h-5 w-5" />
                Email Notifications
              </CardTitle>
              <CardDescription>
                Configure when and how you receive email notifications
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Price Alerts</Label>
                    <p className="text-muted-foreground text-sm">
                      Get notified when prices reach your targets
                    </p>
                  </div>
                  <Switch
                    checked={emailNotifications.priceAlerts}
                    onCheckedChange={(checked) =>
                      setEmailNotifications((prev) => ({
                        ...prev,
                        priceAlerts: checked,
                      }))
                    }
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Position Updates</Label>
                    <p className="text-muted-foreground text-sm">
                      Daily updates on your DeFi positions
                    </p>
                  </div>
                  <Switch
                    checked={emailNotifications.positionUpdates}
                    onCheckedChange={(checked) =>
                      setEmailNotifications((prev) => ({
                        ...prev,
                        positionUpdates: checked,
                      }))
                    }
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Weekly Reports</Label>
                    <p className="text-muted-foreground text-sm">
                      Weekly summary of your portfolio performance
                    </p>
                  </div>
                  <Switch
                    checked={emailNotifications.weeklyReports}
                    onCheckedChange={(checked) =>
                      setEmailNotifications((prev) => ({
                        ...prev,
                        weeklyReports: checked,
                      }))
                    }
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Marketing Emails</Label>
                    <p className="text-muted-foreground text-sm">
                      Product updates and promotional content
                    </p>
                  </div>
                  <Switch
                    checked={emailNotifications.marketingEmails}
                    onCheckedChange={(checked) =>
                      setEmailNotifications((prev) => ({
                        ...prev,
                        marketingEmails: checked,
                      }))
                    }
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Push Notifications */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Smartphone className="h-5 w-5" />
                Push Notifications
              </CardTitle>
              <CardDescription>
                Manage browser and mobile push notifications
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Price Alerts</Label>
                    <p className="text-muted-foreground text-sm">
                      Real-time price movement notifications
                    </p>
                  </div>
                  <Switch
                    checked={pushNotifications.priceAlerts}
                    onCheckedChange={(checked) =>
                      setPushNotifications((prev) => ({
                        ...prev,
                        priceAlerts: checked,
                      }))
                    }
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Liquidation Warnings</Label>
                    <p className="text-muted-foreground text-sm">
                      Urgent alerts for potential liquidations
                    </p>
                  </div>
                  <Switch
                    checked={pushNotifications.liquidations}
                    onCheckedChange={(checked) =>
                      setPushNotifications((prev) => ({
                        ...prev,
                        liquidations: checked,
                      }))
                    }
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Investment Opportunities</Label>
                    <p className="text-muted-foreground text-sm">
                      Notifications about new yield opportunities
                    </p>
                  </div>
                  <Switch
                    checked={pushNotifications.opportunities}
                    onCheckedChange={(checked) =>
                      setPushNotifications((prev) => ({
                        ...prev,
                        opportunities: checked,
                      }))
                    }
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Notification Schedule */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-5 w-5" />
                Notification Schedule
              </CardTitle>
              <CardDescription>
                Set quiet hours and notification frequency
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Quiet Hours</Label>
                    <p className="text-muted-foreground text-sm">
                      Disable notifications during specified hours
                    </p>
                  </div>
                  <Switch />
                </div>

                <div className="space-y-2">
                  <Label>Notification Frequency</Label>
                  <Select defaultValue="realtime">
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="realtime">Real-time</SelectItem>
                      <SelectItem value="hourly">Hourly Digest</SelectItem>
                      <SelectItem value="daily">Daily Summary</SelectItem>
                      <SelectItem value="weekly">Weekly Report</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="billing" className="space-y-6">
          <div className="mt-2 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-medium">Billing History</h3>
                <p className="text-muted-foreground text-sm">
                  View your past and upcoming invoices
                </p>
              </div>
            </div>
            {orders?.result?.items && orders.result.items.length > 0 ? (
              <div className="space-y-4">
                {(orders.result.items || []).map((order) => (
                  <Card key={order.id} className="overflow-hidden">
                    <CardContent className="px-4">
                      <div className="flex flex-col gap-3">
                        {/* Header Row */}
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="flex justify-center gap-2">
                              <h4 className="text-base font-medium">
                                {order.product?.name || 'Subscription'}
                              </h4>
                              <div className="flex items-center gap-2">
                                {order.subscription?.status === 'paid' ? (
                                  <Badge className="bg-green-100 text-xs text-green-800 dark:bg-green-950/50 dark:text-green-400">
                                    Paid
                                  </Badge>
                                ) : order.subscription?.status ===
                                  'canceled' ? (
                                  <Badge
                                    variant="destructive"
                                    className="text-xs"
                                  >
                                    Canceled
                                  </Badge>
                                ) : order.subscription?.status ===
                                  'refunded' ? (
                                  <Badge className="bg-blue-100 text-xs text-blue-800 dark:bg-blue-950/50 dark:text-blue-400">
                                    Refunded
                                  </Badge>
                                ) : (
                                  <Badge variant="outline" className="text-xs">
                                    {order.subscription?.status}
                                  </Badge>
                                )}

                                {order.subscription?.status === 'canceled' && (
                                  <span className="text-muted-foreground text-xs">
                                    • Canceled on{' '}
                                    {order.subscription.endedAt
                                      ? new Date(
                                          order.subscription.endedAt
                                        ).toLocaleDateString('en-US', {
                                          month: 'short',
                                          day: 'numeric',
                                        })
                                      : 'N/A'}
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="text-muted-foreground text-sm">
                              {new Date(order.createdAt).toLocaleDateString(
                                'en-US',
                                {
                                  year: 'numeric',
                                  month: 'short',
                                  day: 'numeric',
                                }
                              )}
                            </div>
                          </div>

                          <div className="text-right">
                            <div className="text-base font-medium">
                              ${(order.totalAmount / 100).toFixed(2)}
                            </div>
                            <div className="text-muted-foreground text-xs">
                              {order.currency?.toUpperCase()}
                            </div>
                          </div>
                        </div>

                        {/* Order Items */}
                        {order.items?.length > 0 && (
                          <div className="mt-2 border-t pt-3">
                            <ul className="space-y-1.5 text-sm">
                              {order.items.map((item, index: number) => (
                                <li
                                  key={`${order.id}-${item.label}-${index}`}
                                  className="flex justify-between"
                                >
                                  <span className="text-muted-foreground max-w-50 truncate">
                                    {item.label}
                                  </span>
                                  <span className="font-medium">
                                    ${(item.amount / 100).toFixed(2)}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <Card>
                <CardContent className="p-8 text-center">
                  <div className="mx-auto flex max-w-105 flex-col items-center justify-center text-center">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      stroke="currentColor"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="1.5"
                      className="text-muted-foreground mb-4 h-10 w-10"
                      viewBox="0 0 24 24"
                    >
                      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
                    </svg>
                    <h3 className="mt-4 text-lg font-semibold">
                      No orders found
                    </h3>
                    <p className="text-muted-foreground mt-2 mb-4 text-sm">
                      {orders === null
                        ? 'Unable to load billing history. This may be because your account is not yet set up for billing.'
                        : "You don't have any orders yet. Your billing history will appear here."}
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}

export default function SettingsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex flex-col gap-6 p-6">
          <div>
            <div className="bg-muted mb-2 h-9 w-32 animate-pulse rounded-md" />
            <div className="bg-muted h-5 w-80 animate-pulse rounded-md" />
          </div>
        </div>
      }
    >
      <SettingsContent />
    </Suspense>
  )
}
