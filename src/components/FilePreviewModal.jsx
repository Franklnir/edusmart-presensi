import React, { useState, useRef, useEffect } from 'react';

const FilePreviewModal = ({ fileUrl, onClose }) => {
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const imageRef = useRef(null);
  const containerRef = useRef(null);

  useEffect(() => {
    setScale(1);
    setPosition({ x: 0, y: 0 });
  }, [fileUrl]);

  const handleWheel = (e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.2 : 0.2;
    const newScale = Math.min(Math.max(0.1, scale + delta), 3);
    
    setScale(newScale);
  };

  const handleMouseDown = (e) => {
    if (scale <= 1) return;
    setIsDragging(true);
    setDragStart({
      x: e.clientX - position.x,
      y: e.clientY - position.y
    });
  };

  const handleMouseMove = (e) => {
    if (!isDragging || scale <= 1) return;
    
    const newX = e.clientX - dragStart.x;
    const newY = e.clientY - dragStart.y;
    
    setPosition({ x: newX, y: newY });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const resetZoom = () => {
    setScale(1);
    setPosition({ x: 0, y: 0 });
  };

  const zoomIn = () => {
    setScale(prev => Math.min(prev + 0.2, 3));
  };

  const zoomOut = () => {
    setScale(prev => Math.max(prev - 0.2, 0.1));
  };

  const getFileType = (url) => {
    if (!url) return 'unknown';
    const extension = url.split('.').pop().toLowerCase();
    
    if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'].includes(extension)) {
      return 'image';
    } else if (extension === 'pdf') {
      return 'pdf';
    } else if (['doc', 'docx'].includes(extension)) {
      return 'document';
    } else if (['xls', 'xlsx'].includes(extension)) {
      return 'spreadsheet';
    } else if (['ppt', 'pptx'].includes(extension)) {
      return 'presentation';
    } else {
      return 'unknown';
    }
  };

  const fileType = getFileType(fileUrl);

  const renderPreview = () => {
    switch (fileType) {
      case 'image':
        return (
          <div 
            ref={containerRef}
            className="flex justify-center items-center h-full overflow-hidden cursor-move"
            onWheel={handleWheel}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
          >
            <img 
              ref={imageRef}
              src={fileUrl} 
              alt="Preview" 
              className="max-w-full max-h-full object-contain transition-transform duration-200"
              style={{ 
                transform: `scale(${scale}) translate(${position.x}px, ${position.y}px)`,
                cursor: scale > 1 ? 'grab' : 'default'
              }}
              onError={(e) => {
                e.target.onerror = null;
                e.target.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjI0IiBoZWlnaHQ9IjI0IiBmaWxsPSIjRjNGNEY2Ii8+CjxwYXRoIGQ9Ik0xOCAxNUwxMiA5TDYgMTUiIHN0cm9rZT0iIzlDQTBCRiIgc3Ryb2tlLXdpZHRoPSIyIiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiLz4KPC9zdmc+Cg==';
              }}
            />
          </div>
        );
      
      case 'pdf':
        return (
          <div className="w-full h-full">
            <iframe 
              src={fileUrl} 
              className="w-full h-full border-0"
              title="PDF Preview"
            />
          </div>
        );
      
      default:
        return (
          <div className="flex flex-col items-center justify-center h-full text-slate-600">
            <div className="text-6xl mb-4">📄</div>
            <p className="text-lg font-medium mb-2">Preview tidak tersedia</p>
            <p className="text-sm mb-4">File ini tidak dapat ditampilkan dalam preview</p>
            <a 
              href={fileUrl} 
              target="_blank" 
              rel="noopener noreferrer"
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              Buka di Tab Baru
            </a>
          </div>
        );
    }
  };

  return (
    <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-6xl h-full max-h-[95vh] flex flex-col shadow-2xl">
        {/* Header dengan Controls */}
        <div className="flex justify-between items-center p-4 border-b border-slate-200 bg-white rounded-t-2xl">
          <div className="flex items-center gap-3">
            <h3 className="font-semibold text-slate-800">Preview File</h3>
            {fileType === 'image' && (
              <div className="flex items-center gap-2 bg-slate-100 rounded-lg p-1">
                <button 
                  onClick={zoomOut}
                  className="w-8 h-8 flex items-center justify-center bg-white rounded-md shadow-sm hover:bg-slate-50 transition-colors"
                  disabled={scale <= 0.2}
                >
                  <span className="text-lg font-bold">−</span>
                </button>
                <span className="text-sm font-medium text-slate-700 min-w-12 text-center">
                  {Math.round(scale * 100)}%
                </span>
                <button 
                  onClick={zoomIn}
                  className="w-8 h-8 flex items-center justify-center bg-white rounded-md shadow-sm hover:bg-slate-50 transition-colors"
                  disabled={scale >= 3}
                >
                  <span className="text-lg font-bold">+</span>
                </button>
                {scale !== 1 && (
                  <button 
                    onClick={resetZoom}
                    className="px-3 py-1 bg-blue-100 text-blue-700 rounded text-sm font-medium hover:bg-blue-200 transition-colors ml-2"
                  >
                    Reset
                  </button>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button 
              onClick={onClose}
              className="w-10 h-10 flex items-center justify-center bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors text-slate-600 font-bold"
            >
              ✕
            </button>
          </div>
        </div>
        
        {/* Content Area */}
        <div className="flex-1 overflow-hidden bg-slate-900">
          {renderPreview()}
        </div>
        
        {/* Footer */}
        <div className="flex justify-between items-center p-4 border-t border-slate-200 bg-white rounded-b-2xl">
          <div className="text-sm text-slate-600">
            {fileType === 'image' && 'Gunakan scroll mouse untuk zoom • Klik dan drag untuk menggeser'}
          </div>
          <div className="flex gap-3">
            <a 
              href={fileUrl} 
              target="_blank" 
              rel="noopener noreferrer"
              className="px-4 py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors font-medium"
            >
              Buka di Tab Baru
            </a>
            <button 
              onClick={onClose}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
            >
              Tutup Preview
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default FilePreviewModal;