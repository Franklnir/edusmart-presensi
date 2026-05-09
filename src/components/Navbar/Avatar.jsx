import React from 'react'

const Avatar = React.memo(({
  avatarUrl,
  className = '',
  onImageError,
  size = 40,
  userInitial = 'U'
}) => {
  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt="Avatar"
        onError={onImageError}
        className={`rounded-full object-cover ${className}`}
        style={{ width: size, height: size }}
      />
    )
  }

  return (
    <div
      className={`rounded-full bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center font-bold text-white ${className}`}
      style={{ width: size, height: size, fontSize: size * 0.38 }}
    >
      {userInitial}
    </div>
  )
})

Avatar.displayName = 'Avatar'

export default Avatar
