import re

with open('backend/routes/api_v2.php', 'r') as f:
    content = f.read()

routes_to_add = """
    // Certificates
    Route::get('certificates', [\App\Http\Controllers\Api\V2\CertificateController::class, 'index'])->name('certificates.index');
    Route::post('certificates', [\App\Http\Controllers\Api\V2\CertificateController::class, 'store'])->name('certificates.store');
    Route::get('certificates/{certificate}', [\App\Http\Controllers\Api\V2\CertificateController::class, 'show'])->name('certificates.show');
    Route::put('certificates/{certificate}', [\App\Http\Controllers\Api\V2\CertificateController::class, 'update'])->name('certificates.update');
    Route::delete('certificates/{certificate}', [\App\Http\Controllers\Api\V2\CertificateController::class, 'destroy'])->name('certificates.destroy');

    // Certificate Templates
    Route::get('certificate-templates', [\App\Http\Controllers\Api\V2\CertificateTemplateController::class, 'index'])->name('certificate-templates.index');
    Route::post('certificate-templates', [\App\Http\Controllers\Api\V2\CertificateTemplateController::class, 'store'])->name('certificate-templates.store');
    Route::get('certificate-templates/{template}', [\App\Http\Controllers\Api\V2\CertificateTemplateController::class, 'show'])->name('certificate-templates.show');
    Route::put('certificate-templates/{template}', [\App\Http\Controllers\Api\V2\CertificateTemplateController::class, 'update'])->name('certificate-templates.update');
    Route::delete('certificate-templates/{template}', [\App\Http\Controllers\Api\V2\CertificateTemplateController::class, 'destroy'])->name('certificate-templates.destroy');
});
"""

content = re.sub(r'\}\);\s*$', routes_to_add, content)

with open('backend/routes/api_v2.php', 'w') as f:
    f.write(content)
