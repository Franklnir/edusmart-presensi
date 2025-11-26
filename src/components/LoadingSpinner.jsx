import React from 'react'

const LoadingSpinner = () => {
  return (
    <div className="flex items-center justify-center min-h-[200px]">
      <div className="h-8 w-8 border-4 border-blue-400 border-t-transparent rounded-full animate-spin"></div>
    </div>
  )
}

export default LoadingSpinner
