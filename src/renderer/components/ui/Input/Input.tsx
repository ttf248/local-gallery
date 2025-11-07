import React from 'react'
import { COLORS } from '@shared/constants'

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  icon?: string
  error?: string
  label?: string
}

const Input: React.FC<InputProps> = ({
  icon,
  error,
  label,
  className = '',
  ...props
}) => {
  return (
    <div className="w-full">
      {label && (
        <label className="block text-sm font-medium text-minimal-text mb-1">
          {label}
        </label>
      )}
      <div className="relative">
        {icon && (
          <i
            className={`${icon} absolute left-3 top-1/2 transform -translate-y-1/2 text-minimal-muted text-sm`}
          />
        )}
        <input
          className={`
            w-full
            px-4
            ${icon ? 'pl-10' : ''}
            py-2
            border
            border-minimal-border
            rounded-md
            text-sm
            text-minimal-text
            bg-white
            placeholder-minimal-muted
            transition-all
            duration-200
            focus:outline-none
            focus:border-minimal-blue
            ${error ? 'border-minimal-red' : ''}
            ${className}
          `}
          style={{
            paddingLeft: icon ? '40px' : '16px',
            borderColor: error ? COLORS.error : undefined,
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = COLORS.primary
            e.currentTarget.style.boxShadow = `0 0 0 3px ${COLORS.primary}20`
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = error ? COLORS.error : COLORS.border
            e.currentTarget.style.boxShadow = 'none'
          }}
          {...props}
        />
      </div>
      {error && (
        <p className="mt-1 text-xs text-minimal-red">{error}</p>
      )}
    </div>
  )
}

export default Input
