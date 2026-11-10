import { createFileRoute } from '@tanstack/react-router'

import { SpaceSettings } from '@renderer/pages/settings/SpaceSettings'

export const Route = createFileRoute('/settings/space')({ component: SpaceSettings })
