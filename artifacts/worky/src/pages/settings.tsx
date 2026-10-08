import { useState, useRef, useEffect } from 'react';
import { useGetMyAccount, useUpdateMyAccount, useChangeMyPassword, getGetMyAccountQueryKey } from '@workspace/api-client-react';
import { queryClient, useAuth } from '@/App';
import { uploadWorkyFile, apiRequest, confirmAccountEmailVerification, requestAccountEmailVerification } from '@/lib/api';
import { ShieldCheck, MapPin, LoaderCircle, Check, ImageIcon, Info, ChevronRight, UserRound } from 'lucide-react';
import { Link } from 'wouter';

// Use same Button as App.tsx but simplified for this page.
function Button({ children, onClick, type = 'button', variant = 'primary', className = '', disabled = false, testId }: any) {
  const styles = {
    primary: 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] shadow-[0_5px_0_hsl(24_70%_42%)] hover:shadow-[0_3px_0_hsl(24_70%_42%)]',
    ghost: 'border border-[hsl(var(--border))] bg-[hsl(var(--card))] text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]',
    dark: 'bg-[hsl(var(--secondary))] text-white hover:bg-[hsl(215_45%_29%)]',
    soft: 'bg-[hsl(var(--accent))] text-[hsl(var(--foreground))] hover:bg-[hsl(42_92%_72%)]',
  }[variant as string];
  return <button type={type} disabled={disabled} onClick={onClick} className={`btn focus-ring inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-55 ${styles} ${className}`} data-testid={testId}>{children}</button>;
}

function requestErrorMessage(error: any, fallback: string) {
  if (typeof error?.data?.error === 'string') return error.data.error;
  return typeof error?.message === 'string' && error.message ? error.message : fallback;
}

export default function SettingsPage() {
  const auth = useAuth();
  const { data: account, isLoading } = useGetMyAccount({ query: { queryKey: getGetMyAccountQueryKey() } });
  
  if (isLoading) {
    return (
      <div className="mx-auto max-w-3xl animate-pulse space-y-8">
        <div className="h-8 w-48 rounded bg-[hsl(var(--muted))]"></div>
        <div className="h-64 rounded-2xl bg-[hsl(var(--muted)/0.5)]"></div>
        <div className="h-64 rounded-2xl bg-[hsl(var(--muted)/0.5)]"></div>
      </div>
    );
  }

  if (!account) return null;

  return (
    <div className="mx-auto max-w-2xl space-y-10 pb-20">
      <div>
        <h1 className="display-font text-3xl font-bold tracking-tight">Tu configuración</h1>
        <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">
          Mantené tu información actualizada para que la comunidad pueda conocerte y confiar en vos.
        </p>
      </div>

      <AccountProfileForm account={account} />
      <AccountLocationForm account={account} />
      <AccountPasswordForm account={account} />
      
      {auth.user?.rol === 'profesional' && (
        <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 sm:p-8">
          <div className="flex items-start gap-4">
            <div className="mt-1 shrink-0 rounded-full bg-[hsl(var(--accent))] p-2.5 text-[hsl(var(--foreground))]">
              <UserRound size={22} />
            </div>
            <div>
              <h3 className="text-lg font-bold">Perfil Profesional</h3>
              <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))] leading-relaxed">
                Tu información de oficio, experiencia, tarifa y galería de trabajos se administra desde la sección de servicios.
              </p>
              <Link href="/services" className="mt-4 inline-flex items-center gap-2 text-sm font-bold text-[hsl(var(--primary))] hover:underline">
                Ir a Mis servicios <ChevronRight size={14} />
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AccountProfileForm({ account }: { account: any }) {
  const updateAccount = useUpdateMyAccount();
  const auth = useAuth();
  const [formData, setFormData] = useState({
    nombre: account.nombre || '',
    email: account.email || '',
    telefono: account.telefono || '',
    edad: account.edad ? String(account.edad) : '',
    currentPassword: '',
  });
  
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const emailChanged = formData.email !== account.email;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  
  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError('');
    try {
      const { objectPath } = await uploadWorkyFile(file, 'profile_photo');
      await apiRequest('/auth/profile-photo', { method: 'POST', body: JSON.stringify({ objectPath }) });
      await queryClient.invalidateQueries({ queryKey: getGetMyAccountQueryKey() });
      await auth.refreshUser(); // update context user
    } catch (err: any) {
      setError(err.message || 'No pudimos subir tu foto.');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess(false);

    if (formData.nombre.trim().length < 2) {
      setError('Ingresá tu nombre completo.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email.trim())) {
      setError('Ingresá un email válido.');
      return;
    }
    const age = formData.edad ? Number(formData.edad) : null;
    if (age !== null && (!Number.isInteger(age) || age < 13 || age > 120)) {
      setError('Ingresá una edad entre 13 y 120 años.');
      return;
    }
    if (emailChanged && !formData.currentPassword) {
      setError('Para cambiar tu email, necesitamos que ingreses tu contraseña actual.');
      return;
    }

    updateAccount.mutate({
      data: {
        nombre: formData.nombre,
        email: formData.email,
        telefono: formData.telefono || null,
        edad: age,
        ...(emailChanged ? { currentPassword: formData.currentPassword } : {}),
      }
    }, {
      onSuccess: () => {
        setSuccess(true);
        setFormData(prev => ({ ...prev, currentPassword: '' }));
        queryClient.invalidateQueries({ queryKey: getGetMyAccountQueryKey() });
        auth.refreshUser();
        setTimeout(() => setSuccess(false), 3000);
      },
      onError: (err: any) => {
        setError(requestErrorMessage(err, 'No pudimos guardar los cambios. Revisá los datos.'));
      }
    });
  };

  const photoUrl = account.fotoObjectPath ? `/api/v1/storage/public-objects${account.fotoObjectPath}` : null;
  const initials = account.nombre.split(' ').map((p: string) => p[0]).slice(0, 2).join('');

  return (
    <section className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] overflow-hidden">
      <div className="border-b border-[hsl(var(--border))] bg-[hsl(var(--muted)/.3)] px-6 py-5 sm:px-8">
        <h2 className="text-lg font-bold">Datos personales</h2>
        <p className="text-sm text-[hsl(var(--muted-foreground))]">Tu identidad en la comunidad Worky.</p>
      </div>
      
      <div className="p-6 sm:p-8">
        <div className="mb-8 flex flex-col sm:flex-row items-center gap-6">
          <div className="relative flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[hsl(var(--secondary))] text-3xl font-bold text-white shadow-inner">
            {photoUrl ? (
              <img src={photoUrl} alt="Tu foto" className="h-full w-full object-cover" />
            ) : (
              initials
            )}
            {uploading && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/50 backdrop-blur-sm">
                <LoaderCircle className="animate-spin text-white" size={24} />
              </div>
            )}
          </div>
          <div className="text-center sm:text-left">
            <h3 className="font-bold text-sm mb-1">Foto de perfil</h3>
            <p className="text-[13px] text-[hsl(var(--muted-foreground))] mb-3 max-w-xs">
              Una foto clara ayuda a que otras personas te reconozcan más fácil.
            </p>
            <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handlePhotoUpload} />
            <Button variant="ghost" onClick={() => fileInputRef.current?.click()} disabled={uploading} className="py-2 h-auto text-xs">
              <ImageIcon size={14} /> Cambiar foto
            </Button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5" noValidate>
          <div className="grid gap-5 sm:grid-cols-2">
            <label className="block space-y-1.5">
              <span className="text-[13px] font-bold">Nombre completo</span>
              <input 
                className="field" 
                value={formData.nombre} 
                onChange={(e) => setFormData({ ...formData, nombre: e.target.value })} 
                required 
                minLength={2} 
                data-testid="input-settings-name"
              />
            </label>
            <label className="block space-y-1.5">
              <span className="text-[13px] font-bold">Edad (opcional)</span>
              <input 
                type="number" 
                className="field" 
                min={13} max={120} 
                value={formData.edad} 
                onChange={(e) => setFormData({ ...formData, edad: e.target.value })} 
                data-testid="input-settings-age"
              />
            </label>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <label className="block space-y-1.5">
              <span className="text-[13px] font-bold">Email</span>
              <input 
                type="email" 
                className="field" 
                value={formData.email} 
                onChange={(e) => setFormData({ ...formData, email: e.target.value })} 
                required 
                data-testid="input-settings-email"
              />
            </label>
            <label className="block space-y-1.5">
              <span className="text-[13px] font-bold">Teléfono (opcional)</span>
              <input 
                type="tel" 
                className="field" 
                value={formData.telefono} 
                onChange={(e) => setFormData({ ...formData, telefono: e.target.value })} 
                data-testid="input-settings-phone"
              />
            </label>
          </div>

          {emailChanged && (
            <div className="rounded-xl bg-[hsl(var(--accent)/.15)] border border-[hsl(var(--accent)/.3)] p-4 mt-6 animate-in slide-in-from-top-2">
              <div className="flex gap-3">
                <Info size={18} className="shrink-0 text-[hsl(var(--accent))] mt-0.5" />
                <div className="space-y-3 w-full">
                  <p className="text-sm font-bold text-[hsl(var(--foreground))]">Confirmá el cambio de email</p>
                  <label className="block space-y-1.5">
                    <span className="text-[13px] font-semibold">Contraseña actual</span>
                    <input 
                      type="password" 
                      className="field bg-white dark:bg-black" 
                      value={formData.currentPassword} 
                      onChange={(e) => setFormData({ ...formData, currentPassword: e.target.value })} 
                      autoComplete="current-password"
                      placeholder="Para proteger tu cuenta"
                      data-testid="input-settings-current-password"
                    />
                  </label>
                </div>
              </div>
            </div>
          )}

          {error && <p className="text-sm font-semibold text-[hsl(var(--destructive))]" data-testid="settings-profile-error">{error}</p>}
          
          <div className="pt-4 flex items-center justify-between border-t border-[hsl(var(--border))]">
            {success ? (
              <span className="flex items-center gap-2 text-sm font-bold text-[#31825a] animate-in fade-in">
                <Check size={16} /> Guardado con éxito
              </span>
            ) : <span />}
            <Button type="submit" disabled={updateAccount.isPending} testId="button-save-profile">
              {updateAccount.isPending ? 'Guardando...' : 'Guardar cambios'}
            </Button>
          </div>
        </form>
      </div>
    </section>
  );
}

function AccountLocationForm({ account }: { account: any }) {
  const updateAccount = useUpdateMyAccount();
  const [formData, setFormData] = useState({
    direccionTexto: account.ubicacion?.direccionTexto || '',
    ciudad: account.ubicacion?.ciudad || '',
    provincia: account.ubicacion?.provincia || '',
  });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess(false);

    updateAccount.mutate({
      data: {
        ubicacion: {
          direccionTexto: formData.direccionTexto,
          ciudad: formData.ciudad,
          provincia: formData.provincia,
        }
      }
    }, {
      onSuccess: () => {
        setSuccess(true);
        queryClient.invalidateQueries({ queryKey: getGetMyAccountQueryKey() });
        setTimeout(() => setSuccess(false), 3000);
      },
      onError: (err: any) => setError(requestErrorMessage(err, 'No pudimos actualizar tu dirección.'))
    });
  };

  return (
    <section className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] overflow-hidden">
      <div className="border-b border-[hsl(var(--border))] bg-[hsl(var(--muted)/.3)] px-6 py-5 sm:px-8">
        <h2 className="text-lg font-bold">Tu barrio</h2>
        <p className="text-sm text-[hsl(var(--muted-foreground))]">De dónde sos para conectarte mejor.</p>
      </div>
      
      <div className="p-6 sm:p-8">
        <div className="mb-6 flex gap-3 rounded-xl bg-[hsl(var(--secondary)/.05)] border border-[hsl(var(--border))] p-4">
          <ShieldCheck size={20} className="shrink-0 text-[hsl(var(--primary))] mt-0.5" />
          <p className="text-sm text-[hsl(var(--muted-foreground))] leading-relaxed">
            <strong className="text-[hsl(var(--foreground))]">Tu dirección exacta es privada.</strong> 
            {' '}Nunca la mostramos públicamente en tu perfil. Solo usamos esta información para sugerirte profesionales o changas cercanas a vos, y se la compartimos a la otra parte únicamente cuando ambas partes aceptan coordinar una visita.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <label className="block space-y-1.5">
            <span className="text-[13px] font-bold">Dirección completa</span>
            <div className="relative">
              <MapPin size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" />
              <input 
                className="field pl-10" 
                value={formData.direccionTexto} 
                onChange={(e) => setFormData({ ...formData, direccionTexto: e.target.value })} 
                placeholder="Calle y número"
                data-testid="input-settings-address"
              />
            </div>
          </label>
          
          <div className="grid gap-5 sm:grid-cols-2">
            <label className="block space-y-1.5">
              <span className="text-[13px] font-bold">Ciudad / Localidad</span>
              <input 
                className="field" 
                value={formData.ciudad} 
                onChange={(e) => setFormData({ ...formData, ciudad: e.target.value })} 
                data-testid="input-settings-city"
              />
            </label>
            <label className="block space-y-1.5">
              <span className="text-[13px] font-bold">Provincia</span>
              <input 
                className="field" 
                value={formData.provincia} 
                onChange={(e) => setFormData({ ...formData, provincia: e.target.value })} 
                data-testid="input-settings-province"
              />
            </label>
          </div>

          {error && <p className="text-sm font-semibold text-[hsl(var(--destructive))]" data-testid="settings-location-error">{error}</p>}
          
          <div className="pt-4 flex items-center justify-between border-t border-[hsl(var(--border))]">
            {success ? (
              <span className="flex items-center gap-2 text-sm font-bold text-[#31825a] animate-in fade-in">
                <Check size={16} /> Barrio actualizado
              </span>
            ) : <span />}
            <Button type="submit" disabled={updateAccount.isPending} testId="button-save-location">
              {updateAccount.isPending ? 'Guardando...' : 'Actualizar barrio'}
            </Button>
          </div>
        </form>
      </div>
    </section>
  );
}

function AccountPasswordForm({ account }: { account: any }) {
  const changePassword = useChangeMyPassword();
  const auth = useAuth();
  const [formData, setFormData] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [emailCodeSent, setEmailCodeSent] = useState(false);
  const [emailCode, setEmailCode] = useState('');
  const [emailMessage, setEmailMessage] = useState('');
  const [emailError, setEmailError] = useState('');
  const [emailBusy, setEmailBusy] = useState(false);
  const [verifiedLocally, setVerifiedLocally] = useState(false);
  const emailIsVerified = verifiedLocally || Boolean(account.emailVerifiedAt);

  useEffect(() => {
    setEmailCodeSent(false);
    setEmailCode('');
    setEmailMessage('');
    setEmailError('');
    setVerifiedLocally(false);
  }, [account.email]);

  const sendEmailCode = async () => {
    setEmailBusy(true);
    setEmailError('');
    setEmailMessage('');
    try {
      const result = await requestAccountEmailVerification();
      setEmailCodeSent(true);
      setEmailMessage(result.message);
    } catch (cause) {
      setEmailError(requestErrorMessage(cause, 'No pudimos enviar el código.'));
    } finally {
      setEmailBusy(false);
    }
  };

  const confirmEmailCode = async (event: React.FormEvent) => {
    event.preventDefault();
    setEmailError('');
    if (!/^\d{6}$/.test(emailCode)) {
      setEmailError('Ingresá el código de 6 dígitos.');
      return;
    }
    setEmailBusy(true);
    try {
      await confirmAccountEmailVerification(emailCode);
      setVerifiedLocally(true);
      setEmailCodeSent(false);
      setEmailCode('');
      setEmailMessage('Tu email quedó verificado.');
      void auth.refreshUser();
      void queryClient.invalidateQueries({ queryKey: getGetMyAccountQueryKey() });
    } catch (cause) {
      setEmailError(requestErrorMessage(cause, 'No pudimos verificar el código.'));
    } finally {
      setEmailBusy(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess(false);

    if (!formData.currentPassword) {
      setError('Ingresá tu contraseña actual.');
      return;
    }
    if (formData.newPassword !== formData.confirmPassword) {
      setError('Las contraseñas nuevas no coinciden.');
      return;
    }
    if (formData.newPassword.length < 8) {
      setError('La nueva contraseña debe tener al menos 8 caracteres.');
      return;
    }

    changePassword.mutate({
      data: {
        currentPassword: formData.currentPassword,
        newPassword: formData.newPassword,
      }
    }, {
      onSuccess: () => {
        setSuccess(true);
        setFormData({ currentPassword: '', newPassword: '', confirmPassword: '' });
        setTimeout(() => setSuccess(false), 4000);
      },
      onError: (err: any) => {
        setError(requestErrorMessage(err, 'Hubo un error al cambiar tu contraseña.'));
      }
    });
  };

  return (
    <section className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] overflow-hidden">
      <div className="border-b border-[hsl(var(--border))] bg-[hsl(var(--muted)/.3)] px-6 py-5 sm:px-8">
        <h2 className="text-lg font-bold">Seguridad</h2>
        <p className="text-sm text-[hsl(var(--muted-foreground))]">Protegé el acceso a tu cuenta.</p>
      </div>
      
      <div className="p-6 sm:p-8">
        <div className="mb-7 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--muted)/.25)] p-4" data-testid="email-verification-settings">
          <div className="flex items-start gap-3">
            <ShieldCheck size={19} className={`mt-0.5 shrink-0 ${emailIsVerified ? 'text-[#31825a]' : 'text-[hsl(var(--primary))]'}`} />
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-bold">Verificación de email</h3>
              <p className="mt-1 break-all text-xs text-[hsl(var(--muted-foreground))]">{account.email}</p>
              <p className="mt-2 text-sm font-semibold" role="status" aria-live="polite">
                {emailIsVerified ? 'Email verificado' : 'Tu email todavía no está verificado.'}
              </p>
              {emailMessage && <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]" role="status">{emailMessage}</p>}
              {emailError && <p className="mt-2 text-xs font-semibold text-[hsl(var(--destructive))]" role="alert" data-testid="settings-email-verification-error">{emailError}</p>}
              {!emailIsVerified && !emailCodeSent && (
                <Button onClick={() => void sendEmailCode()} disabled={emailBusy} className="mt-3" testId="button-send-email-verification">
                  {emailBusy ? 'Enviando código…' : 'Enviar código de verificación'}
                </Button>
              )}
              {!emailIsVerified && emailCodeSent && (
                <form onSubmit={confirmEmailCode} className="mt-4 max-w-sm space-y-3">
                  <label className="block space-y-1.5">
                    <span className="text-[13px] font-bold">Código de 6 dígitos</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      pattern="[0-9]{6}"
                      maxLength={6}
                      required
                      className="field"
                      value={emailCode}
                      onChange={(event) => { setEmailCode(event.target.value.replace(/\D/g, '').slice(0, 6)); setEmailError(''); }}
                      data-testid="input-settings-email-code"
                    />
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <Button type="submit" disabled={emailBusy} testId="button-confirm-settings-email">
                      {emailBusy ? 'Verificando…' : 'Verificar email'}
                    </Button>
                    <Button type="button" variant="ghost" onClick={() => void sendEmailCode()} disabled={emailBusy} testId="button-resend-settings-email-code">
                      Reenviar código
                    </Button>
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
        <form onSubmit={handleSubmit} className="space-y-5" noValidate>
          <label className="block space-y-1.5 max-w-sm">
            <span className="text-[13px] font-bold">Contraseña actual</span>
            <input 
              type="password" 
              className="field" 
              value={formData.currentPassword} 
              onChange={(e) => setFormData({ ...formData, currentPassword: e.target.value })} 
              autoComplete="current-password"
              required 
              data-testid="input-settings-old-password"
            />
          </label>
          
          <div className="grid gap-5 sm:grid-cols-2">
            <label className="block space-y-1.5">
              <span className="text-[13px] font-bold">Nueva contraseña</span>
              <input 
                type="password" 
                className="field" 
                value={formData.newPassword} 
                onChange={(e) => setFormData({ ...formData, newPassword: e.target.value })} 
                autoComplete="new-password"
                required 
                minLength={8}
                data-testid="input-settings-new-password"
              />
            </label>
            <label className="block space-y-1.5">
              <span className="text-[13px] font-bold">Repetir contraseña</span>
              <input 
                type="password" 
                className="field" 
                value={formData.confirmPassword} 
                onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })} 
                autoComplete="new-password"
                required 
                minLength={8}
                data-testid="input-settings-confirm-password"
              />
            </label>
          </div>

          {error && <p className="text-sm font-semibold text-[hsl(var(--destructive))]" data-testid="settings-password-error">{error}</p>}
          
          <div className="pt-4 flex items-center justify-between border-t border-[hsl(var(--border))]">
            {success ? (
              <span className="flex items-center gap-2 text-sm font-bold text-[#31825a] animate-in fade-in">
                <Check size={16} /> Contraseña actualizada
              </span>
            ) : <span />}
            <Button type="submit" variant="dark" disabled={changePassword.isPending || !formData.currentPassword || !formData.newPassword} testId="button-save-password">
              {changePassword.isPending ? 'Actualizando...' : 'Cambiar contraseña'}
            </Button>
          </div>
        </form>
      </div>
    </section>
  );
}
