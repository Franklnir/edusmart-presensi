@props(['url'])
<tr>
<td class="header">
<a href="{{ $url }}" style="display: inline-block;">
@php
$logoPath = public_path('logo-sismu.png');
$logoUrl = file_exists($logoPath) ? asset('logo-sismu.png') : null;
@endphp
@if ($logoUrl)
<img src="{{ $logoUrl }}" class="logo" alt="{{ config('app.name') }}" style="max-height: 50px;">
@else
<span style="font-size: 18px; font-weight: bold; color: #2563eb;">{{ config('app.name') }}</span>
@endif
</a>
</td>
</tr>
