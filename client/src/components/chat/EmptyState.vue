<script setup lang="ts">
import { FolderIcon } from '@lucide/vue'
import { Suggestion } from '@/components/ai-elements/suggestion'
import { useChat } from '@/composables/useChat'
import { computed } from 'vue'

const { cwd, sendMessage } = useChat()

const projectName = computed(() => cwd.value.split('/').filter(Boolean).pop() || '~')

const suggestions = [
  '介绍一下这个项目的结构',
  '看看最近的 git 改动',
  '运行测试并修复失败的用例',
]
</script>

<template>
  <div class="flex flex-col items-center justify-center gap-5 px-4 text-center">
    <div class="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
      <FolderIcon class="size-6" />
    </div>
    <div class="space-y-1">
      <div class="text-[17px] font-semibold">
        {{ projectName }}
      </div>
      <div class="max-w-72 truncate font-mono text-xs text-muted-foreground">
        {{ cwd || '连接中…' }}
      </div>
    </div>
    <div class="flex w-full max-w-xs flex-col gap-2">
      <Suggestion
        v-for="s in suggestions"
        :key="s"
        :suggestion="s"
        class="h-11 w-full justify-start rounded-xl text-left font-normal text-muted-foreground"
        @click="sendMessage"
      />
    </div>
  </div>
</template>
