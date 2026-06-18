import { spawn, type ChildProcess } from 'child_process'
import { syncCodeDocs, watchCodeDocs } from './code-docs.ts'

function startRspressDev() {
  return spawn('rspress', ['dev'], {
    shell: true,
    stdio: 'inherit',
  })
}

async function stop(rspress: ChildProcess, closeWatcher: () => Promise<void>) {
  await closeWatcher()

  if (!rspress.killed) {
    rspress.kill('SIGTERM')
  }
}

syncCodeDocs(true)

const watcher = watchCodeDocs()
const rspress = startRspressDev()

rspress.on('exit', (code, signal) => {
  void watcher.close().finally(() => {
    if (signal) {
      process.exit(0)
      return
    }

    process.exit(code ?? 0)
  })
})

process.on('SIGINT', () => {
  void stop(rspress, watcher.close).finally(() => process.exit(0))
})

process.on('SIGTERM', () => {
  void stop(rspress, watcher.close).finally(() => process.exit(0))
})
