<script setup lang="ts">
import type { SessionSummary } from '@/lib/protocol'
import { ChevronLeftIcon, EllipsisIcon, FolderIcon, PlusIcon, Trash2Icon } from '@lucide/vue'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { useChat } from '@/composables/useChat'
import { useUi } from '@/composables/useUi'
import { relativeTime } from '@/lib/time'
import { cn } from '@/lib/utils'
import { computed, ref, watch } from 'vue'

const { sessions, currentSessionId, projectPaths, switchSession, createSession, closeSession, refreshSessions } = useChat()
const { sessionsOpen } = useUi()

const view = ref<'list' | 'new'>('list')
const newPath = ref('')
// Kept separate from the dialog's open state: the confirm button closes the
// dialog before its click handler runs.
const closing = ref<SessionSummary | null>(null)
const confirmOpen = ref(false)

watch(sessionsOpen, (open) => {
  if (open) {
    refreshSessions()
  }
  else {
    view.value = 'list'
    newPath.value = ''
  }
})

const baseName = (p: string) => p.split('/').filter(Boolean).pop() || p

// Sessions grouped by project directory, most recently active group first.
const groups = computed(() => {
  const map = new Map<string, SessionSummary[]>()
  for (const s of sessions.value) {
    if (!map.has(s.cwd))
      map.set(s.cwd, [])
    map.get(s.cwd)!.push(s)
  }
  return [...map.entries()].map(([cwd, list]) => ({ cwd, name: baseName(cwd), list }))
})

const filteredPaths = computed(() => {
  const q = newPath.value.trim().toLowerCase()
  return q ? projectPaths.value.filter(p => p.cwd.toLowerCase().includes(q)) : projectPaths.value
})

function pick(id: string) {
  switchSession(id)
  sessionsOpen.value = false
}

function create(cwd: string) {
  createSession(cwd.trim())
  sessionsOpen.value = false
}

function askClose(s: SessionSummary) {
  closing.value = s
  confirmOpen.value = true
}

function confirmClose() {
  if (closing.value)
    closeSession(closing.value.id)
}
</script>

<template>
  <Sheet v-model:open="sessionsOpen">
    <SheetContent side="left" class="w-[86%] max-w-sm gap-0 p-0 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] [&>button:last-child]:top-[calc(env(safe-area-inset-top)+1.1rem)]">
      <!-- Session list -->
      <template v-if="view === 'list'">
        <SheetHeader class="px-4 pt-4 pb-2">
          <SheetTitle>Sessions</SheetTitle>
          <SheetDescription class="sr-only">
            Switch or start a session
          </SheetDescription>
        </SheetHeader>
        <div class="px-3 pb-2">
          <Button variant="outline" class="h-11 w-full justify-start gap-2" @click="view = 'new'">
            <PlusIcon class="size-4" />
            New session
          </Button>
        </div>
        <div class="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
          <div v-for="group in groups" :key="group.cwd" class="mt-3">
            <div class="flex items-center gap-1.5 px-2 pb-1 text-xs text-muted-foreground">
              <FolderIcon class="size-3.5" />
              <span class="truncate">{{ group.name }}</span>
            </div>
            <div
              v-for="s in group.list"
              :key="s.id"
              :class="cn('flex items-center rounded-lg', s.id === currentSessionId ? 'bg-accent' : 'hover:bg-accent/60')"
            >
              <button type="button" class="min-h-12 min-w-0 flex-1 px-2 py-2 text-left" @click="pick(s.id)">
                <div class="truncate text-sm font-medium">
                  {{ s.title }}
                </div>
                <div class="text-xs text-muted-foreground">
                  {{ relativeTime(s.lastActivity) }}
                </div>
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger as-child>
                  <button type="button" class="flex size-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground" :aria-label="`More actions for ${s.title}`">
                    <EllipsisIcon class="size-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem variant="destructive" class="min-h-10" @select="askClose(s)">
                    <Trash2Icon class="size-4" />
                    Close session
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>
      </template>

      <!-- New session -->
      <template v-else>
        <SheetHeader class="flex-row items-center gap-1 px-2 pt-3 pb-2">
          <button type="button" class="flex size-10 items-center justify-center rounded-full hover:bg-accent" aria-label="Back" @click="view = 'list'">
            <ChevronLeftIcon class="size-5" />
          </button>
          <SheetTitle>New session</SheetTitle>
          <SheetDescription class="sr-only">
            Choose a project directory
          </SheetDescription>
        </SheetHeader>
        <div class="flex gap-2 px-4 pb-3">
          <Input v-model="newPath" placeholder="Project path (blank for default)" class="h-11 font-mono text-sm" @keydown.enter="create(newPath)" />
          <Button class="h-11 shrink-0" @click="create(newPath)">
            Create
          </Button>
        </div>
        <div class="px-4 pb-1 text-xs text-muted-foreground">
          Recent projects
        </div>
        <div class="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
          <button
            v-for="p in filteredPaths"
            :key="p.cwd"
            type="button"
            class="flex min-h-12 w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-accent"
            @click="create(p.cwd)"
          >
            <FolderIcon class="size-4 shrink-0 text-muted-foreground" />
            <span class="min-w-0 flex-1">
              <span class="block truncate text-sm font-medium">{{ p.label }}</span>
              <span class="block truncate font-mono text-xs text-muted-foreground">{{ p.cwd }}</span>
            </span>
            <span class="shrink-0 text-xs text-muted-foreground">{{ relativeTime(p.lastUsed) }}</span>
          </button>
          <div v-if="!filteredPaths.length" class="px-2 py-6 text-center text-sm text-muted-foreground">
            {{ projectPaths.length ? 'No matching projects. Tap "Create" to use the entered path' : 'No recent projects found' }}
          </div>
        </div>
      </template>
    </SheetContent>
  </Sheet>

  <AlertDialog v-model:open="confirmOpen">
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>Close this session?</AlertDialogTitle>
        <AlertDialogDescription>
          The chat history of “{{ closing?.title }}” will be deleted and can't be recovered.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>Cancel</AlertDialogCancel>
        <AlertDialogAction class="bg-destructive text-white hover:bg-destructive/90" @click="confirmClose">
          Close session
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
