import { forwardRef, useEffect, useState } from 'react'
import type { Icon, IconProps } from '@phosphor-icons/react'

function deferredIcon(load: () => Promise<Icon>): Icon {
  if (import.meta.env.MODE === 'test') {
    return forwardRef<SVGSVGElement, IconProps>((props, _ref) => {
      const size = props.size ?? '1em'
      return <span aria-hidden="true" className={props.className} style={{ display: 'inline-block', flex: '0 0 auto', width: size, height: size }} />
    }) as Icon
  }

  let icon: Icon | null = null
  let loading: Promise<Icon | null> | null = null

  return forwardRef<SVGSVGElement, IconProps>((props, ref) => {
    const [, showIcon] = useState(false)

    useEffect(() => {
      let active = true
      const startLoading = () => {
        loading ??= load().then((loadedIcon) => (icon = loadedIcon)).catch(() => null)
        void loading.then((loadedIcon) => { if (active && loadedIcon) showIcon(true) })
      }
      const idleId = window.requestIdleCallback?.(startLoading, { timeout: 2_000 })
      const timerId = idleId === undefined ? window.setTimeout(startLoading, 5_000) : undefined
      return () => {
        active = false
        if (idleId === undefined) window.clearTimeout(timerId)
        else window.cancelIdleCallback(idleId)
      }
    }, [])

    const LoadedIcon = icon
    if (LoadedIcon) return <LoadedIcon {...props} ref={ref} />

    const size = props.size ?? '1em'
    return <span aria-hidden="true" className={props.className} style={{ display: 'inline-block', flex: '0 0 auto', width: size, height: size }} />
  }) as Icon
}

export const ArrowLeft = deferredIcon(() => import('@phosphor-icons/react/ArrowLeft').then((module) => module.ArrowLeft))
export const ArrowRight = deferredIcon(() => import('@phosphor-icons/react/ArrowRight').then((module) => module.ArrowRight))
export const ArrowSquareOut = deferredIcon(() => import('@phosphor-icons/react/ArrowSquareOut').then((module) => module.ArrowSquareOut))
export const Atom = deferredIcon(() => import('@phosphor-icons/react/Atom').then((module) => module.Atom))
export const BookOpenText = deferredIcon(() => import('@phosphor-icons/react/BookOpenText').then((module) => module.BookOpenText))
export const CalendarDots = deferredIcon(() => import('@phosphor-icons/react/CalendarDots').then((module) => module.CalendarDots))
export const CaretDown = deferredIcon(() => import('@phosphor-icons/react/CaretDown').then((module) => module.CaretDown))
export const CaretRight = deferredIcon(() => import('@phosphor-icons/react/CaretRight').then((module) => module.CaretRight))
export const ChatCircleText = deferredIcon(() => import('@phosphor-icons/react/ChatCircleText').then((module) => module.ChatCircleText))
export const Check = deferredIcon(() => import('@phosphor-icons/react/Check').then((module) => module.Check))
export const CheckCircle = deferredIcon(() => import('@phosphor-icons/react/CheckCircle').then((module) => module.CheckCircle))
export const CircleNotch = deferredIcon(() => import('@phosphor-icons/react/CircleNotch').then((module) => module.CircleNotch))
export const ClockCountdown = deferredIcon(() => import('@phosphor-icons/react/ClockCountdown').then((module) => module.ClockCountdown))
export const CreditCard = deferredIcon(() => import('@phosphor-icons/react/CreditCard').then((module) => module.CreditCard))
export const Flask = deferredIcon(() => import('@phosphor-icons/react/Flask').then((module) => module.Flask))
export const Hash = deferredIcon(() => import('@phosphor-icons/react/Hash').then((module) => module.Hash))
export const House = deferredIcon(() => import('@phosphor-icons/react/House').then((module) => module.House))
export const ImageSquare = deferredIcon(() => import('@phosphor-icons/react/ImageSquare').then((module) => module.ImageSquare))
export const Lightbulb = deferredIcon(() => import('@phosphor-icons/react/Lightbulb').then((module) => module.Lightbulb))
export const Lifebuoy = deferredIcon(() => import('@phosphor-icons/react/Lifebuoy').then((module) => module.Lifebuoy))
export const LinkSimple = deferredIcon(() => import('@phosphor-icons/react/LinkSimple').then((module) => module.LinkSimple))
export const MagnifyingGlass = deferredIcon(() => import('@phosphor-icons/react/MagnifyingGlass').then((module) => module.MagnifyingGlass))
export const Moon = deferredIcon(() => import('@phosphor-icons/react/Moon').then((module) => module.Moon))
export const Notebook = deferredIcon(() => import('@phosphor-icons/react/Notebook').then((module) => module.Notebook))
export const PaperPlaneTilt = deferredIcon(() => import('@phosphor-icons/react/PaperPlaneTilt').then((module) => module.PaperPlaneTilt))
export const Question = deferredIcon(() => import('@phosphor-icons/react/Question').then((module) => module.Question))
export const ShieldCheck = deferredIcon(() => import('@phosphor-icons/react/ShieldCheck').then((module) => module.ShieldCheck))
export const ShoppingCartSimple = deferredIcon(() => import('@phosphor-icons/react/ShoppingCartSimple').then((module) => module.ShoppingCartSimple))
export const SpinnerGap = deferredIcon(() => import('@phosphor-icons/react/SpinnerGap').then((module) => module.SpinnerGap))
export const Stack = deferredIcon(() => import('@phosphor-icons/react/Stack').then((module) => module.Stack))
export const Sun = deferredIcon(() => import('@phosphor-icons/react/Sun').then((module) => module.Sun))
export const UploadSimple = deferredIcon(() => import('@phosphor-icons/react/UploadSimple').then((module) => module.UploadSimple))
export const UserCircle = deferredIcon(() => import('@phosphor-icons/react/UserCircle').then((module) => module.UserCircle))
export const WarningCircle = deferredIcon(() => import('@phosphor-icons/react/WarningCircle').then((module) => module.WarningCircle))
export const X = deferredIcon(() => import('@phosphor-icons/react/X').then((module) => module.X))
