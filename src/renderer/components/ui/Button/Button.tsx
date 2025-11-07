import React from 'react'
import { COLORS } from '@shared/constants'

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'default' | 'danger'
  size?: 'sm' | 'md' | 'lg'
  icon?: string
  children: React.ReactNode
}

const Button: React.FC<ButtonProps> = ({
  variant = 'default',
  size = 'md',
  icon,
  children,
  className = '',
  ...props
}) => {
  // 变体样式
  const variantStyles: Record<string, any> = {
    primary: {
      background: COLORS.primary,
      color: 'white',
      border: `1px solid ${COLORS.primary}`,
      hover: {
        background: COLORS.primaryHover,
        border: COLORS.primaryHover,
        color: 'white',
      },
    },
    secondary: {
      background: COLORS.surface,
      color: COLORS.textMuted,
      border: `1px solid ${COLORS.border}`,
      hover: {
        color: COLORS.primary,
        border: COLORS.primary,
        background: COLORS.background,
      },
    },
    default: {
      background: 'transparent',
      color: COLORS.textMuted,
      border: `1px solid transparent`,
      hover: {
        color: COLORS.primary,
        background: COLORS.background,
        border: 'transparent',
      },
    },
    danger: {
      background: COLORS.error,
      color: 'white',
      border: `1px solid ${COLORS.error}`,
      hover: {
        background: '#C0392B',
        border: '#C0392B',
        color: 'white',
      },
    },
  }

  // 尺寸样式
  const sizeStyles = {
    sm: {
      padding: 'px-3 py-1.5',
      fontSize: 'text-xs',
    },
    md: {
      padding: 'px-4 py-2',
      fontSize: 'text-sm',
    },
    lg: {
      padding: 'px-5 py-2.5',
      fontSize: 'text-base',
    },
  }

  const style = variantStyles[variant]
  const sizeStyle = sizeStyles[size]

  return (
    <button
      className={`
        ${sizeStyle.padding}
        ${sizeStyle.fontSize}
        font-medium
        rounded-md
        transition-all
        duration-200
        ease-in-out
        flex
        items-center
        justify-center
        ${className}
      `}
      style={{
        backgroundColor: style.background,
        color: style.color,
        borderColor: style.border,
        borderWidth: '1px',
        borderStyle: 'solid',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.backgroundColor = style.hover.background
        e.currentTarget.style.color = style.hover.color
        e.currentTarget.style.borderColor = style.hover.border
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = style.background
        e.currentTarget.style.color = style.color
        e.currentTarget.style.borderColor = style.border
      }}
      {...props}
    >
      {icon && <i className={`${icon} ${children ? 'mr-2' : ''}`} />}
      {children}
    </button>
  )
}

export default Button
