import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getRoleSwitcherLabel,
  getRoleSwitcherTarget,
  hasDualRoleAccount,
  resolveEffectiveRole,
  shouldShowPartnerSignupCta,
  shouldShowProfessionalSearch,
} from '../src/lib/role-view.ts';

test('una cuenta profesional puede cambiar de vista y una cuenta cliente solo si tiene perfil profesional', () => {
  assert.equal(hasDualRoleAccount('profesional', null), true);
  assert.equal(hasDualRoleAccount('cliente', null), false);
  assert.equal(hasDualRoleAccount('cliente', { id: 12 }), true);
  assert.equal(hasDualRoleAccount('admin', { id: 12 }), true);
  assert.equal(hasDualRoleAccount('admin', null), false);
});

test('la vista inicial respeta el rol de cuenta y evita activar Partner para una cuenta solo cliente', () => {
  assert.equal(resolveEffectiveRole('profesional', 'client', false, true), 'professional');
  assert.equal(resolveEffectiveRole('profesional', 'client', true, true), 'client');
  assert.equal(resolveEffectiveRole('cliente', 'professional', true, false), 'client');
  assert.equal(resolveEffectiveRole('cliente', 'professional', true, true), 'professional');
  assert.equal(resolveEffectiveRole('admin', 'client', true, false), 'client');
  assert.equal(resolveEffectiveRole('admin', 'admin', false, false), 'client');
  assert.equal(resolveEffectiveRole('admin', 'admin', true, true), 'client');
  assert.equal(resolveEffectiveRole('admin', 'professional', true, true), 'professional');
  assert.equal(resolveEffectiveRole('admin', 'professional', true, false), 'client');
  assert.equal(resolveEffectiveRole('admin', 'client', true, true), 'client');
  assert.equal(resolveEffectiveRole('admin', 'admin', false, true), 'professional');
});

test('la invitación a ofrecer servicios solo aparece a clientes sin perfil profesional confirmado', () => {
  assert.equal(shouldShowPartnerSignupCta('client', 'cliente', null, false, false), true);
  assert.equal(shouldShowPartnerSignupCta('client', 'cliente', { id: 12 }, false, false), false);
  assert.equal(shouldShowPartnerSignupCta('client', 'profesional', null, false, false), false);
  assert.equal(shouldShowPartnerSignupCta('professional', 'cliente', null, false, false), false);
  assert.equal(shouldShowPartnerSignupCta('client', 'cliente', null, true, false), false);
  assert.equal(shouldShowPartnerSignupCta('client', 'cliente', null, false, true), false);
});

test('la búsqueda de profesionales solo aparece en la vista cliente', () => {
  assert.equal(shouldShowProfessionalSearch('client'), true);
  assert.equal(shouldShowProfessionalSearch('professional'), false);
});

test('la etiqueta y el destino indican la otra vista disponible', () => {
  assert.equal(getRoleSwitcherLabel('client'), 'Cambiar a Profesional');
  assert.equal(getRoleSwitcherTarget('client'), 'professional');
  assert.equal(getRoleSwitcherLabel('professional'), 'Cambiar a Cliente');
  assert.equal(getRoleSwitcherTarget('professional'), 'client');
});