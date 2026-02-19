import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';

import { Service } from '../../../core/models/service.model';

@Component({
  selector: 'app-service-metadata-modal',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './service-metadata-modal.component.html',
  styleUrl: './service-metadata-modal.component.scss',
})
export class ServiceMetadataModalComponent {
  @Input({ required: true }) form!: FormGroup;
  @Input() service: Service | null = null;
  @Input() open = false;
  @Input() saving = false;
  @Input() canEdit = false;

  @Output() closed = new EventEmitter<void>();
  @Output() submitted = new EventEmitter<void>();

  get title() {
    return this.service ? `Service metadata · ${this.service.name}` : 'Service metadata';
  }

  get submitLabel() {
    if (!this.canEdit) return 'Stop both slots to edit';
    return this.saving ? 'Saving…' : 'Save details';
  }

  get submitDisabled() {
    return this.saving || this.form.invalid || !this.canEdit;
  }

  close() {
    this.closed.emit();
  }

  submit() {
    if (this.submitDisabled) return;
    this.submitted.emit();
  }
}
