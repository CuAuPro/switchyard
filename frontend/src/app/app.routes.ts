import { Routes } from '@angular/router';
import { LoginPageComponent } from './pages/login/login.page';
import { DashboardPageComponent } from './pages/dashboard/dashboard.page';
import { authGuard } from './core/guards/auth.guard';

export const routes: Routes = [
  { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
  { path: 'login', component: LoginPageComponent },
  { path: 'dashboard', component: DashboardPageComponent, canActivate: [authGuard] },
  { path: '**', redirectTo: 'dashboard' },
];
