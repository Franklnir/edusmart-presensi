<?php

namespace App\Mail;

use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Attachment;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;

class SertifikatMail extends Mailable implements ShouldQueue
{
    use Queueable, SerializesModels;

    public $certificate;

    public $studentName;

    public $downloadUrl;

    public $schoolName;

    /**
     * Create a new message instance.
     */
    public function __construct($certificate, $studentName, $downloadUrl, $schoolName)
    {
        $this->certificate = $certificate;
        $this->studentName = $studentName;
        $this->downloadUrl = $downloadUrl;
        $this->schoolName = $schoolName;
    }

    /**
     * Get the message envelope.
     */
    public function envelope(): Envelope
    {
        return new Envelope(
            subject: 'Sertifikat Anda - '.$this->certificate->event,
        );
    }

    /**
     * Get the message content definition.
     */
    public function content(): Content
    {
        return new Content(
            markdown: 'emails.sertifikat',
        );
    }

    /**
     * Get the attachments for the message.
     *
     * @return array<int, Attachment>
     */
    public function attachments(): array
    {
        return [];
    }
}
