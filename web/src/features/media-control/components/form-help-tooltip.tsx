/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { CircleQuestionMark } from 'lucide-react'
import { useId, type ReactNode } from 'react'

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'

type FormHelpTooltipProps = {
  ariaLabel: string
  children: ReactNode
}

export function FormHelpTooltip(props: FormHelpTooltipProps) {
  const tooltipID = useId()
  const trigger = (
    <button
      type='button'
      aria-label={props.ariaLabel}
      aria-describedby={tooltipID}
      className='text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 inline-flex size-5 shrink-0 items-center justify-center rounded-md border border-transparent transition-colors outline-none focus-visible:ring-2'
    >
      <CircleQuestionMark
        aria-hidden='true'
        className='size-3.5 [&>circle]:hidden'
      />
    </button>
  )

  return (
    <TooltipProvider delay={0}>
      <Tooltip>
        <TooltipTrigger render={trigger} />
        <TooltipContent
          id={tooltipID}
          role='tooltip'
          className='max-w-72 leading-relaxed'
        >
          <p>{props.children}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
