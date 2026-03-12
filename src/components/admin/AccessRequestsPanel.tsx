'use client'

import { useState, useEffect, useCallback } from 'react'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { Check, X, MessageSquare } from 'lucide-react'

interface AccessRequest {
  id: number
  email: string
  name: string
  message: string | null
  status: string
  createdAt: string
  updatedAt: string
}

type TabStatus = 'pending' | 'approved' | 'denied'

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export function AccessRequestsPanel() {
  const [requests, setRequests] = useState<AccessRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<TabStatus>('pending')
  const [fadingIds, setFadingIds] = useState<Set<number>>(new Set())
  const [actioningIds, setActioningIds] = useState<Set<number>>(new Set())

  const fetchRequests = useCallback(async () => {
    try {
      const res = await fetch('/api/access-requests')
      if (res.ok) {
        const json = await res.json() as { data: AccessRequest[] }
        setRequests(json.data)
      } else {
        console.error('Failed to fetch access requests:', res.status)
      }
    } catch (err) {
      console.error('Failed to fetch access requests:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchRequests()
  }, [fetchRequests])

  const handleAction = async (id: number, status: 'approved' | 'denied') => {
    setActioningIds((prev) => new Set(prev).add(id))

    try {
      const res = await fetch(`/api/access-requests/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })

      if (res.ok) {
        setFadingIds((prev) => new Set(prev).add(id))

        setTimeout(() => {
          setRequests((prev) =>
            prev.map((r) =>
              r.id === id
                ? { ...r, status, updatedAt: new Date().toISOString() }
                : r
            )
          )
          setFadingIds((prev) => {
            const next = new Set(prev)
            next.delete(id)
            return next
          })
        }, 200)
      } else {
        const json = await res.json().catch(() => ({ error: 'Unknown error' })) as { error?: string }
        console.error('Failed to update access request:', json.error)
        await fetchRequests()
      }
    } catch (err) {
      console.error('Failed to update access request:', err)
    } finally {
      setActioningIds((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }
  }

  const filteredRequests = requests.filter((r) => r.status === activeTab)
  const pendingCount = requests.filter((r) => r.status === 'pending').length

  return (
    <div>
      <div className="flex items-baseline justify-between mb-6">
        <h1 className="text-xl sm:text-2xl font-semibold">Access Requests</h1>
        {pendingCount > 0 && (
          <span className="text-sm text-muted-foreground">
            {pendingCount} pending
          </span>
        )}
      </div>

      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as TabStatus)}
      >
        <TabsList>
          <TabsTrigger value="pending">
            Pending
            {pendingCount > 0 && (
              <Badge
                variant="default"
                className="ml-1.5 h-5 min-w-5 px-1.5 text-xs"
              >
                {pendingCount}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="approved">Approved</TabsTrigger>
          <TabsTrigger value="denied">Denied</TabsTrigger>
        </TabsList>

        <TabsContent value={activeTab} className="mt-4">
          <div
            className="transition-opacity duration-150"
            style={{ opacity: loading ? 0.5 : 1 }}
          >
            {loading ? (
              <p className="text-sm text-muted-foreground py-8 text-center">
                Loading...
              </p>
            ) : filteredRequests.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">
                No {activeTab} requests
              </p>
            ) : (
              <div className="border rounded-lg overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Message</TableHead>
                      {activeTab === 'pending' ? (
                        <TableHead className="text-right">Actions</TableHead>
                      ) : (
                        <TableHead>Updated</TableHead>
                      )}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredRequests.map((req) => (
                      <TableRow
                        key={req.id}
                        className="transition-opacity duration-200"
                        style={{
                          opacity: fadingIds.has(req.id) ? 0 : 1,
                        }}
                      >
                        <TableCell className="font-medium">
                          {req.name}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {req.email}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {formatDate(req.createdAt)}
                        </TableCell>
                        <TableCell>
                          {req.message ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="inline-flex items-center gap-1 text-muted-foreground cursor-default">
                                  <MessageSquare className="size-3.5" />
                                  <span className="max-w-[150px] truncate text-sm">
                                    {req.message}
                                  </span>
                                </span>
                              </TooltipTrigger>
                              <TooltipContent
                                side="top"
                                className="max-w-xs whitespace-pre-wrap"
                              >
                                {req.message}
                              </TooltipContent>
                            </Tooltip>
                          ) : (
                            <span className="text-muted-foreground/50 text-sm">
                              -
                            </span>
                          )}
                        </TableCell>
                        {activeTab === 'pending' ? (
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-2">
                              <Button
                                size="sm"
                                className="bg-emerald-600 hover:bg-emerald-700 text-white"
                                disabled={actioningIds.has(req.id)}
                                onClick={() => handleAction(req.id, 'approved')}
                              >
                                <Check className="size-3.5" />
                                Approve
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="text-destructive border-destructive/30 hover:bg-destructive/10"
                                disabled={actioningIds.has(req.id)}
                                onClick={() => handleAction(req.id, 'denied')}
                              >
                                <X className="size-3.5" />
                                Deny
                              </Button>
                            </div>
                          </TableCell>
                        ) : (
                          <TableCell className="text-muted-foreground">
                            {formatDate(req.updatedAt)}
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
