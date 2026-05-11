/**
 * HomesteadAuth — manages Supabase auth for the Homestead scene.
 *
 * Responsibilities:
 *   1. Anonymous sign-in on scene entry (no UI blocker)
 *   2. Status pill showing Guest / email / Sign out
 *   3. Login modal with magic link + Google OAuth
 *
 * The login modal is rendered as an HTML overlay (DOM) because Phaser's
 * canvas can't handle text inputs. The status pill is a Phaser text object.
 *
 * Issues: #854, #855, #856
 */

import * as Phaser from 'phaser';
import { supabase } from './supabaseClient';
import type { Session } from '@supabase/supabase-js';

// ── Status pill (Phaser HUD) ───────────────────────────────────────────────

const PILL_DEPTH = 300;
const PILL_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontSize: '11px',
  color: '#ddeedd',
  backgroundColor: '#00000088',
  padding: { x: 8, y: 4 },
};

export class HomesteadAuth {
  private pill: Phaser.GameObjects.Text;
  private session: Session | null = null;
  private modalEl: HTMLDivElement | null = null;

  constructor(scene: Phaser.Scene) {
    // Status pill — top-right corner, fixed to camera
    const cam = scene.cameras.main;
    this.pill = scene.add
      .text(cam.width - 8, 8, 'Connecting…', PILL_STYLE)
      .setOrigin(1, 0)
      .setScrollFactor(0)
      .setDepth(PILL_DEPTH)
      .setInteractive({ useHandCursor: true });

    this.pill.on('pointerdown', () => this.onPillTap());

    this.initAuth();
  }

  // ── Auth lifecycle ─────────────────────────────────────────────────────

  private async initAuth(): Promise<void> {
    if (!supabase) {
      this.updatePill('No DB');
      return;
    }

    // Listen for auth state changes (magic link callback, sign-out, etc.)
    supabase.auth.onAuthStateChange((_event, session) => {
      this.session = session;
      this.updatePill(this.labelForSession(session));
    });

    // Check for existing session first
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
      this.session = session;
      this.updatePill(this.labelForSession(session));
      return;
    }

    // No session — sign in anonymously
    const { data, error } = await supabase.auth.signInAnonymously();
    if (error) {
      console.warn('[HomesteadAuth] anonymous sign-in failed:', error.message);
      this.updatePill('Offline');
      return;
    }
    this.session = data.session;
    this.updatePill(this.labelForSession(data.session));
  }

  private labelForSession(session: Session | null): string {
    if (!session) return 'Guest';
    const user = session.user;
    // Anonymous users have no email and is_anonymous flag
    if (user.is_anonymous) return 'Guest';
    return user.email ?? 'Signed in';
  }

  private updatePill(label: string): void {
    this.pill.setText(label);
  }

  // ── Pill tap handler ───────────────────────────────────────────────────

  private onPillTap(): void {
    if (!supabase) return;

    if (this.session?.user.is_anonymous) {
      // Guest — show login modal
      this.showLoginModal();
    } else if (this.session) {
      // Signed in — show sign-out option
      this.showSignOutModal();
    }
  }

  // ── Login modal (HTML overlay) ─────────────────────────────────────────

  private showLoginModal(): void {
    if (this.modalEl) return; // already open

    const modal = document.createElement('div');
    modal.id = 'homestead-login-modal';
    modal.innerHTML = `
      <div style="
        position: fixed; inset: 0; background: rgba(0,0,0,0.7);
        display: flex; align-items: center; justify-content: center;
        z-index: 9999; font-family: 'Syne', sans-serif;
      ">
        <div style="
          background: #1a2a1a; border: 2px solid #3a5a3a; border-radius: 8px;
          padding: 24px; width: 320px; color: #ddeedd;
        ">
          <h3 style="margin: 0 0 16px; font-size: 16px; color: #aaccaa;">
            Sign in to save progress
          </h3>

          <!-- Google OAuth button -->
          <button id="hs-google-btn" style="
            width: 100%; padding: 10px; margin-bottom: 12px;
            background: #4285f4; color: white; border: none; border-radius: 4px;
            font-size: 14px; cursor: pointer; font-family: 'Syne', sans-serif;
          ">Continue with Google</button>

          <div style="
            text-align: center; color: #667766; font-size: 12px; margin-bottom: 12px;
          ">or</div>

          <!-- Magic link email -->
          <input id="hs-email-input" type="email" placeholder="your@email.com" style="
            width: 100%; padding: 8px; margin-bottom: 8px;
            background: #0a1a0a; border: 1px solid #3a5a3a; border-radius: 4px;
            color: #ddeedd; font-size: 14px; font-family: 'Syne', sans-serif;
            box-sizing: border-box;
          " />
          <button id="hs-magic-btn" style="
            width: 100%; padding: 8px;
            background: #2a4a2a; color: #aaccaa; border: 1px solid #3a5a3a;
            border-radius: 4px; font-size: 13px; cursor: pointer;
            font-family: 'Syne', sans-serif;
          ">Send magic link</button>

          <div id="hs-login-status" style="
            margin-top: 12px; font-size: 12px; color: #88aa88; min-height: 18px;
          "></div>

          <button id="hs-close-btn" style="
            display: block; margin: 16px auto 0; padding: 6px 16px;
            background: none; border: 1px solid #3a5a3a; border-radius: 4px;
            color: #667766; font-size: 12px; cursor: pointer;
            font-family: 'Syne', sans-serif;
          ">Cancel</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
    this.modalEl = modal;

    // Wire up buttons
    const googleBtn = document.getElementById('hs-google-btn')!;
    const magicBtn = document.getElementById('hs-magic-btn')!;
    const closeBtn = document.getElementById('hs-close-btn')!;
    const emailInput = document.getElementById('hs-email-input') as HTMLInputElement;
    const statusDiv = document.getElementById('hs-login-status')!;

    googleBtn.addEventListener('click', async () => {
      if (!supabase) return;
      // signInWithOAuth redirects the page — we'll land back on /homestead
      // with the session set via detectSessionInUrl.
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin + '/homestead' },
      });
      if (error) {
        statusDiv.textContent = error.message;
        statusDiv.style.color = '#cc6666';
      }
    });

    magicBtn.addEventListener('click', async () => {
      if (!supabase) return;
      const email = emailInput.value.trim();
      if (!email) {
        statusDiv.textContent = 'Please enter an email address.';
        statusDiv.style.color = '#cc6666';
        return;
      }

      magicBtn.textContent = 'Sending…';
      (magicBtn as HTMLButtonElement).disabled = true;

      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: window.location.origin + '/homestead' },
      });

      if (error) {
        statusDiv.textContent = error.message;
        statusDiv.style.color = '#cc6666';
        magicBtn.textContent = 'Send magic link';
        (magicBtn as HTMLButtonElement).disabled = false;
      } else {
        statusDiv.textContent = 'Check your email for the magic link!';
        statusDiv.style.color = '#88cc88';
        magicBtn.textContent = 'Sent ✓';
      }
    });

    closeBtn.addEventListener('click', () => this.closeModal());

    // Close on backdrop click
    modal.firstElementChild!.addEventListener('click', (e) => {
      if (e.target === modal.firstElementChild) this.closeModal();
    });
  }

  // ── Sign-out modal ─────────────────────────────────────────────────────

  private showSignOutModal(): void {
    if (this.modalEl) return;

    const email = this.session?.user.email ?? 'Unknown';
    const modal = document.createElement('div');
    modal.id = 'homestead-login-modal';
    modal.innerHTML = `
      <div style="
        position: fixed; inset: 0; background: rgba(0,0,0,0.7);
        display: flex; align-items: center; justify-content: center;
        z-index: 9999; font-family: 'Syne', sans-serif;
      ">
        <div style="
          background: #1a2a1a; border: 2px solid #3a5a3a; border-radius: 8px;
          padding: 24px; width: 280px; color: #ddeedd; text-align: center;
        ">
          <p style="margin: 0 0 8px; font-size: 12px; color: #88aa88;">Signed in as</p>
          <p style="margin: 0 0 16px; font-size: 14px; color: #aaccaa;">${email}</p>
          <button id="hs-signout-btn" style="
            padding: 8px 24px; background: #4a2a2a; color: #cc8888;
            border: 1px solid #5a3a3a; border-radius: 4px; font-size: 13px;
            cursor: pointer; font-family: 'Syne', sans-serif;
          ">Sign out</button>
          <button id="hs-close-btn" style="
            display: block; margin: 12px auto 0; padding: 6px 16px;
            background: none; border: 1px solid #3a5a3a; border-radius: 4px;
            color: #667766; font-size: 12px; cursor: pointer;
            font-family: 'Syne', sans-serif;
          ">Cancel</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
    this.modalEl = modal;

    document.getElementById('hs-signout-btn')!.addEventListener('click', async () => {
      if (!supabase) return;
      await supabase.auth.signOut();
      this.closeModal();
      // signOut triggers onAuthStateChange → new anonymous sign-in
      const { data } = await supabase.auth.signInAnonymously();
      if (data.session) {
        this.session = data.session;
        this.updatePill(this.labelForSession(data.session));
      }
    });

    document.getElementById('hs-close-btn')!.addEventListener('click', () => this.closeModal());

    modal.firstElementChild!.addEventListener('click', (e) => {
      if (e.target === modal.firstElementChild) this.closeModal();
    });
  }

  private closeModal(): void {
    if (this.modalEl) {
      this.modalEl.remove();
      this.modalEl = null;
    }
  }
}
