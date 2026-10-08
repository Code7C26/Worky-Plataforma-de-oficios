import assert from 'node:assert/strict';
import test from 'node:test';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import {
  createConversationOnPress,
  getConversationInboxQuery,
  getConversationRowPresentation,
  getUnreadConversationCount,
} from '../lib/conversation-inbox.ts';
import { switchRoleAfterServerConfirmation } from '../lib/role-switch.ts';

const clientConversation = {
  changaId: 412,
  estado: 'en_curso',
  categoria: 'Plomería',
  detalle: null,
  updatedAt: '2026-09-30T11:00:00',
  unread: 3,
  interlocutor: {
    id: 28,
    nombre: 'Camila Partner',
    email: 'camila@example.com',
    fotoObjectPath: 'profile-photos/camila.webp',
    rol: 'profesional',
  },
  ultimoMensaje: {
    id: 901,
    changaId: 412,
    emisorId: 28,
    texto: 'Llego a las 15, ¿te sirve?',
    adjuntos: [],
    leido: false,
    createdAt: '2026-09-30T12:34:00',
    emisor: {
      id: 28,
      nombre: 'Camila Partner',
      email: 'camila@example.com',
      fotoObjectPath: 'profile-photos/camila.webp',
      rol: 'profesional',
    },
  },
};

const partnerConversation = {
  changaId: 719,
  estado: 'aceptada',
  categoria: 'Electricidad',
  detalle: null,
  updatedAt: '2026-09-28T09:00:00',
  unread: 0,
  interlocutor: {
    id: 39,
    nombre: 'Diego Cliente',
    email: 'diego@example.com',
    rol: 'cliente',
  },
  ultimoMensaje: {
    id: 1204,
    changaId: 719,
    emisorId: 39,
    texto: 'Gracias, quedamos así.',
    adjuntos: [],
    leido: true,
    createdAt: '2026-09-28T09:00:00',
    emisor: {
      id: 39,
      nombre: 'Diego Cliente',
      email: 'diego@example.com',
      rol: 'cliente',
    },
  },
};

function waitForConversation(observer, changaId) {
  const matchingResult = (result) => result.data?.some((conversation) => conversation.changaId === changaId);
  const currentResult = observer.getCurrentResult();
  if (currentResult.isSuccess && matchingResult(currentResult)) return Promise.resolve(currentResult);
  if (currentResult.isError) return Promise.reject(currentResult.error);

  return new Promise((resolve, reject) => {
    let unsubscribe = () => {};
    let settled = false;
    const checkResult = (result) => {
      if (result.isError) {
        settled = true;
        unsubscribe();
        reject(result.error);
      } else if (result.isSuccess && matchingResult(result)) {
        settled = true;
        unsubscribe();
        resolve(result);
      }
    };

    unsubscribe = observer.subscribe(checkResult);
    if (settled) unsubscribe();
    checkResult(observer.getCurrentResult());
  });
}

test('Cliente y Partner consultan bandejas y cachés separadas por su propio rol', () => {
  const clientQuery = getConversationInboxQuery('cliente');
  const partnerQuery = getConversationInboxQuery('profesional');

  assert.equal(clientQuery.role, 'cliente');
  assert.deepEqual(clientQuery.params, { rol: 'cliente' });
  assert.deepEqual(clientQuery.query.queryKey, ['/api/v1/conversaciones', 'cliente']);

  assert.equal(partnerQuery.role, 'profesional');
  assert.deepEqual(partnerQuery.params, { rol: 'profesional' });
  assert.deepEqual(partnerQuery.query.queryKey, ['/api/v1/conversaciones', 'profesional']);
  assert.notDeepEqual(clientQuery.query.queryKey, partnerQuery.query.queryKey);

  assert.equal(clientConversation.interlocutor.rol, 'profesional');
  assert.equal(partnerConversation.interlocutor.rol, 'cliente');
});

test('el contador de Mensajes sigue los no leídos al cambiar Cliente → Partner → Cliente', async () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const requestedRoles = [];
  const switchedRoles = [];
  let account = { rol: 'cliente' };
  const requestSwitchRole = async ({ rol }) => {
    switchedRoles.push(rol);
    return { rol };
  };
  const requestConversations = async ({ rol }) => {
    requestedRoles.push(rol);
    return rol === 'profesional'
      ? [{ ...partnerConversation, unread: 5 }]
      : [clientConversation];
  };
  const optionsForRole = (accountRole) => {
    const inboxQuery = getConversationInboxQuery(accountRole);
    return {
      ...inboxQuery.query,
      queryFn: () => requestConversations(inboxQuery.params),
    };
  };
  const observer = new QueryObserver(queryClient, optionsForRole(account.rol));
  const unsubscribe = observer.subscribe(() => {});
  const commitConfirmedAccount = (updatedAccount) => {
    account = updatedAccount;
    observer.setOptions(optionsForRole(account.rol));
  };

  try {
    const clientResult = await waitForConversation(observer, clientConversation.changaId);
    assert.deepEqual(clientResult.data.map(({ changaId }) => changaId), [clientConversation.changaId]);
    assert.equal(getUnreadConversationCount(clientResult.data), 3);

    await switchRoleAfterServerConfirmation('profesional', requestSwitchRole, commitConfirmedAccount);
    assert.equal(account.rol, 'profesional');
    assert.equal(observer.getCurrentResult().data, undefined, 'no debe mantener visibles las filas de Cliente durante el cambio');
    assert.equal(getUnreadConversationCount(observer.getCurrentResult().data), 0);
    const partnerResult = await waitForConversation(observer, partnerConversation.changaId);
    assert.deepEqual(partnerResult.data.map(({ changaId }) => changaId), [partnerConversation.changaId]);
    assert.equal(getUnreadConversationCount(partnerResult.data), 5);

    await switchRoleAfterServerConfirmation('cliente', requestSwitchRole, commitConfirmedAccount);
    assert.equal(account.rol, 'cliente');
    const returnedClientResult = await waitForConversation(observer, clientConversation.changaId);
    assert.deepEqual(returnedClientResult.data.map(({ changaId }) => changaId), [clientConversation.changaId]);
    assert.equal(getUnreadConversationCount(returnedClientResult.data), 3);
    assert.deepEqual(requestedRoles, ['cliente', 'profesional']);
    assert.deepEqual(switchedRoles, ['profesional', 'cliente']);
  } finally {
    unsubscribe();
    queryClient.clear();
  }
});

test('un error al cambiar de rol mantiene la bandeja actual y permite reintentar', async () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let account = { rol: 'cliente' };
  let shouldFailSwitch = true;
  const requestedRoles = [];
  const queriedRoles = [];

  const requestSwitchRole = async ({ rol }) => {
    requestedRoles.push(rol);
    if (shouldFailSwitch) throw new Error('No se pudo cambiar el perfil.');
    return { rol };
  };
  const optionsForRole = (role) => {
    const inboxQuery = getConversationInboxQuery(role);
    return {
      ...inboxQuery.query,
      queryFn: async () => {
        queriedRoles.push(role);
        return role === 'profesional' ? [partnerConversation] : [clientConversation];
      },
    };
  };
  const observer = new QueryObserver(queryClient, optionsForRole(account.rol));
  const unsubscribe = observer.subscribe(() => {});
  const commitConfirmedAccount = (updatedAccount) => {
    account = updatedAccount;
    observer.setOptions(optionsForRole(account.rol));
  };

  try {
    const initialResult = await waitForConversation(observer, clientConversation.changaId);
    const originalRows = initialResult.data;
    const originalQueryKey = observer.options.queryKey;

    await assert.rejects(
      switchRoleAfterServerConfirmation('profesional', requestSwitchRole, commitConfirmedAccount),
      /No se pudo cambiar el perfil/,
    );

    assert.equal(account.rol, 'cliente');
    assert.deepEqual(observer.options.queryKey, originalQueryKey);
    assert.strictEqual(observer.getCurrentResult().data, originalRows);
    assert.deepEqual(
      observer.getCurrentResult().data.map(({ changaId }) => changaId),
      [clientConversation.changaId],
    );
    assert.deepEqual(requestedRoles, ['profesional']);
    assert.deepEqual(queriedRoles, ['cliente']);

    shouldFailSwitch = false;
    const updatedAccount = await switchRoleAfterServerConfirmation(
      'profesional',
      requestSwitchRole,
      commitConfirmedAccount,
    );
    const partnerResult = await waitForConversation(observer, partnerConversation.changaId);

    assert.equal(updatedAccount.rol, 'profesional');
    assert.equal(account.rol, 'profesional');
    assert.deepEqual(partnerResult.data.map(({ changaId }) => changaId), [partnerConversation.changaId]);
    assert.deepEqual(requestedRoles, ['profesional', 'profesional']);
    assert.deepEqual(queriedRoles, ['cliente', 'profesional']);
  } finally {
    unsubscribe();
    queryClient.clear();
  }
});

test('tocar una fila abre el trabajo y participante correctos e incluye la foto si está disponible', () => {
  const clientRoutes = [];
  createConversationOnPress(clientConversation, (route) => clientRoutes.push(route))();
  assert.deepEqual(clientRoutes, [{
    pathname: '/chat/[changaId]',
    params: {
      changaId: '412',
      category: 'Plomería',
      participant: 'Camila Partner',
      participantPhotoPath: 'profile-photos/camila.webp',
    },
  }]);

  const partnerRoutes = [];
  createConversationOnPress(partnerConversation, (route) => partnerRoutes.push(route))();
  assert.deepEqual(partnerRoutes, [{
    pathname: '/chat/[changaId]',
    params: {
      changaId: '719',
      category: 'Electricidad',
      participant: 'Diego Cliente',
    },
  }]);
});

test('la fila refleja el último mensaje, la fecha y los no leídos devueltos por el API', () => {
  const now = new Date('2026-09-30T16:00:00');
  const formattedDates = [];
  const formatShortDate = (value) => {
    formattedDates.push(value ?? '');
    return '29 sep';
  };

  const clientRow = getConversationRowPresentation(clientConversation, now, formatShortDate);
  assert.equal(clientRow.name, 'Camila Partner');
  assert.equal(clientRow.category, 'Plomería');
  assert.equal(clientRow.photoObjectPath, 'profile-photos/camila.webp');
  assert.equal(clientRow.preview, 'Llego a las 15, ¿te sirve?');
  assert.equal(
    clientRow.time,
    new Intl.DateTimeFormat('es-AR', { hour: '2-digit', minute: '2-digit' })
      .format(new Date(clientConversation.ultimoMensaje.createdAt)),
  );
  assert.equal(clientRow.unreadBadge, '3');
  assert.equal(clientRow.accessibilityLabel, 'Abrir conversación con Camila Partner, 3 mensajes sin leer');

  const partnerRow = getConversationRowPresentation(partnerConversation, now, formatShortDate);
  assert.equal(partnerRow.preview, 'Gracias, quedamos así.');
  assert.equal(partnerRow.time, '29 sep');
  assert.equal(partnerRow.unreadBadge, null);
  assert.deepEqual(formattedDates, ['2026-09-28T09:00:00']);
});

test('la fila limita el distintivo a 99+ y usa el texto inicial si aún no hay mensajes', () => {
  const noMessages = {
    ...clientConversation,
    unread: 120,
    interlocutor: null,
    ultimoMensaje: null,
    updatedAt: '2026-09-30T12:34:00',
  };

  const row = getConversationRowPresentation(noMessages, new Date('2026-09-30T16:00:00'), () => 'fecha');

  assert.equal(row.name, 'Conversación');
  assert.equal(row.preview, 'Empezá la conversación');
  assert.equal(row.unreadBadge, '99+');
});

test('la fila indica los adjuntos del último mensaje cuando no tiene texto', () => {
  const photoMessage = {
    ...clientConversation,
    ultimoMensaje: {
      ...clientConversation.ultimoMensaje,
      texto: '',
      adjuntos: [{ objectPath: '/objects/chat-attachments/photo.jpg', nombre: 'photo.jpg' }],
    },
  };
  const fileMessage = {
    ...clientConversation,
    ultimoMensaje: {
      ...clientConversation.ultimoMensaje,
      texto: '   ',
      adjuntos: [
        { objectPath: '/objects/chat-attachments/photo.jpg', nombre: 'photo.jpg' },
        { objectPath: '/objects/chat-attachments/document.pdf', nombre: 'document.pdf' },
      ],
    },
  };
  const textAndAttachmentMessage = {
    ...clientConversation,
    ultimoMensaje: {
      ...clientConversation.ultimoMensaje,
      texto: 'Te mando una foto.',
      adjuntos: [{ objectPath: '/objects/chat-attachments/photo.jpg', nombre: 'photo.jpg' }],
    },
  };
  const now = new Date('2026-09-30T16:00:00');

  assert.equal(getConversationRowPresentation(photoMessage, now, () => 'fecha').preview, 'Archivo adjunto');
  assert.equal(getConversationRowPresentation(fileMessage, now, () => 'fecha').preview, '2 archivos adjuntos');
  assert.equal(getConversationRowPresentation(textAndAttachmentMessage, now, () => 'fecha').preview, 'Te mando una foto.');
});