<?php
require 'vendor/autoload.php';
$app = require_once 'bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use App\Models\User;
use App\Models\Profile;

$user = User::factory()->create();
$profile = Profile::create([
    'id' => $user->id,
    'tenant_id' => 'tenant-1',
    'nama' => 'Guru Test',
    'email' => $user->email,
    'role' => 'guru',
]);
echo "Profile ID: " . $profile->id . "\n";
echo "Profile tenant_id: " . $profile->tenant_id . "\n";
$fetched = Profile::find($user->id);
if ($fetched) {
    echo "Fetched tenant_id: " . $fetched->tenant_id . "\n";
} else {
    echo "Profile not found in DB!\n";
}
