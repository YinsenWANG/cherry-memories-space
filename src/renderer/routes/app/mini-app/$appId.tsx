import { createFileRoute } from '@tanstack/react-router'

import MiniAppPage from '@renderer/pages/miniApps/MiniAppPage'
import SpacePage from '@renderer/pages/space/SpacePage'

export const Route = createFileRoute('/app/mini-app/$appId')({
  component: MiniAppRoute
})

function MiniAppRoute() {
  const { appId } = Route.useParams()
  return appId === 'cherry-studio-memories' ? <SpacePage /> : <MiniAppPage />
}
