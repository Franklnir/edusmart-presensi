import React from 'react'
import {
  AlertTriangle,
  CircleCheck,
  Clock,
  Eye,
  EyeOff,
  Facebook,
  Instagram,
  LockKeyhole,
  LogIn,
  Mail,
  Music2,
  School,
  ShieldCheck,
  Smartphone,
  User,
  UserPlus,
  UserRound,
  UserStar,
  Youtube
} from 'lucide-react'

const ICONS = [
  [/ri-facebook/, Facebook],
  [/ri-tiktok/, Music2],
  [/ri-instagram/, Instagram],
  [/ri-youtube/, Youtube],
  [/ri-school/, School],
  [/ri-shield-check/, ShieldCheck],
  [/ri-time/, Clock],
  [/ri-smartphone/, Smartphone],
  [/ri-alert/, AlertTriangle],
  [/ri-checkbox-circle/, CircleCheck],
  [/ri-user-star/, UserStar],
  [/ri-user-add/, UserPlus],
  [/ri-user-3|ri-user-fill/, UserRound],
  [/ri-mail/, Mail],
  [/ri-lock-password/, LockKeyhole],
  [/ri-eye-off/, EyeOff],
  [/ri-eye/, Eye],
  [/ri-login-box/, LogIn]
]

export default function AuthIcon({ className = '', ...props }) {
  const Icon = ICONS.find(([pattern]) => pattern.test(className))?.[1] || User

  return (
    <i className={className} aria-hidden="true" {...props}>
      <Icon className="auth-icon__svg" strokeWidth={2.15} />
    </i>
  )
}
