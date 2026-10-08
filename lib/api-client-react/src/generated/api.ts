}







export const getUpdateJobUrl = (id: number,) => {




  return `/api/v1/trabajos/${id}`
}

/**
 * @summary Update job state
 */
export const updateJob = async (id: number,
    jobUpdate: JobUpdate, options?: Parameters<typeof customFetch>[1]): Promise<Job> => {

  return customFetch<Job>(getUpdateJobUrl(id),
  {
    ...options,
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    body: JSON.stringify(jobUpdate)
  }
);}





export const getUpdateJobMutationOptions = <TError = ErrorType<unknown>,
    TContext = unknown>(options?: { mutation?:UseMutationOptions<Awaited<ReturnType<typeof updateJob>>, TError,{id: number;data: BodyType<JobUpdate>}, TContext>, request?: SecondParameter<typeof customFetch>}
): UseMutationOptions<Awaited<ReturnType<typeof updateJob>>, TError,{id: number;data: BodyType<JobUpdate>}, TContext> => {

const mutationKey = ['updateJob'];
const {mutation: mutationOptions, request: requestOptions} = options ?
      options.mutation && 'mutationKey' in options.mutation && options.mutation.mutationKey ?
      options
      : {...options, mutation: {...options.mutation, mutationKey}}
      : {mutation: { mutationKey, }, request: undefined};




      const mutationFn: MutationFunction<Awaited<ReturnType<typeof updateJob>>, {id: number;data: BodyType<JobUpdate>}> = (props) => {
          const {id,data} = props ?? {};

          return  updateJob(id,data,requestOptions)
        }






  return  { mutationFn, ...mutationOptions }}

    export type UpdateJobMutationResult = NonNullable<Awaited<ReturnType<typeof updateJob>>>
    export type UpdateJobMutationBody = BodyType<JobUpdate>
    export type UpdateJobMutationError = ErrorType<unknown>

    /**
 * @summary Update job state
 */
export const useUpdateJob = <TError = ErrorType<unknown>,
    TContext = unknown>(options?: { mutation?:UseMutationOptions<Awaited<ReturnType<typeof updateJob>>, TError,{id: number;data: BodyType<JobUpdate>}, TContext>, request?: SecondParameter<typeof customFetch>}
 ): UseMutationResult<
        Awaited<ReturnType<typeof updateJob>>,
        TError,
        {id: number;data: BodyType<JobUpdate>},
        TContext
      > => {
      return useMutation(getUpdateJobMutationOptions(options));
    }

export const getAcceptJobUrl = (id: number,) => {




  return `/api/v1/trabajos/${id}/aceptar`
}

/**
 * @summary Accept an available job
 */
export const acceptJob = async (id: number, options?: Parameters<typeof customFetch>[1]): Promise<Job> => {

  return customFetch<Job>(getAcceptJobUrl(id),
  {
    ...options,
    method: 'PATCH'


  }
);}





export const getAcceptJobMutationOptions = <TError = ErrorType<unknown>,
    TContext = unknown>(options?: { mutation?:UseMutationOptions<Awaited<ReturnType<typeof acceptJob>>, TError,{id: number}, TContext>, request?: SecondParameter<typeof customFetch>}
): UseMutationOptions<Awaited<ReturnType<typeof acceptJob>>, TError,{id: number}, TContext> => {

const mutationKey = ['acceptJob'];
const {mutation: mutationOptions, request: requestOptions} = options ?
      options.mutation && 'mutationKey' in options.mutation && options.mutation.mutationKey ?
      options
      : {...options, mutation: {...options.mutation, mutationKey}}
      : {mutation: { mutationKey, }, request: undefined};




      const mutationFn: MutationFunction<Awaited<ReturnType<typeof acceptJob>>, {id: number}> = (props) => {
          const {id} = props ?? {};

          return  acceptJob(id,requestOptions)
        }






  return  { mutationFn, ...mutationOptions }}

    export type AcceptJobMutationResult = NonNullable<Awaited<ReturnType<typeof acceptJob>>>

    export type AcceptJobMutationError = ErrorType<unknown>

    /**
 * @summary Accept an available job
 */
export const useAcceptJob = <TError = ErrorType<unknown>,
    TContext = unknown>(options?: { mutation?:UseMutationOptions<Awaited<ReturnType<typeof acceptJob>>, TError,{id: number}, TContext>, request?: SecondParameter<typeof customFetch>}
 ): UseMutationResult<
        Awaited<ReturnType<typeof acceptJob>>,
        TError,
        {id: number},
        TContext
      > => {
      return useMutation(getAcceptJobMutationOptions(options));
    }

export const getListConversationsUrl = (params?: ListConversationsParams,) => {
  const normalizedParams = new URLSearchParams();

  Object.entries(params || {}).forEach(([key, value]) => {

    if (value !== undefined) {
      normalizedParams.append(key, value === null ? 'null' : String(value))
    }
  });

  const stringifiedParams = normalizedParams.toString();

  return stringifiedParams.length > 0 ? `/api/v1/conversaciones?${stringifiedParams}` : `/api/v1/conversaciones`
}

/**
 * @summary List the current user's conversations
 */
export const listConversations = async (params?: ListConversationsParams, options?: Parameters<typeof customFetch>[1]): Promise<Conversation[]> => {

  return customFetch<Conversation[]>(getListConversationsUrl(params),
  {
    ...options,
    method: 'GET'


  }
);}





export const getListConversationsQueryKey = (params?: ListConversationsParams,) => {
    return [
    `/api/v1/conversaciones`, ...(params ? [params] : [])
    ] as const;
    }


export const getListConversationsQueryOptions = <TData = Awaited<ReturnType<typeof listConversations>>, TError = ErrorType<unknown>>(params?: ListConversationsParams, options?: { query?:UseQueryOptions<Awaited<ReturnType<typeof listConversations>>, TError, TData>, request?: SecondParameter<typeof customFetch>}
) => {

const {query: queryOptions, request: requestOptions} = options ?? {};

  const queryKey =  queryOptions?.queryKey ?? getListConversationsQueryKey(params);



    const queryFn: QueryFunction<Awaited<ReturnType<typeof listConversations>>> = ({ signal }) => listConversations(params, { signal, ...requestOptions });





   return  { queryKey, queryFn, ...queryOptions} as UseQueryOptions<Awaited<ReturnType<typeof listConversations>>, TError, TData> & { queryKey: QueryKey }
}

export type ListConversationsQueryResult = NonNullable<Awaited<ReturnType<typeof listConversations>>>
export type ListConversationsQueryError = ErrorType<unknown>


/**
 * @summary List the current user's conversations
 */

export function useListConversations<TData = Awaited<ReturnType<typeof listConversations>>, TError = ErrorType<unknown>>(
 params?: ListConversationsParams, options?: { query?:UseQueryOptions<Awaited<ReturnType<typeof listConversations>>, TError, TData>, request?: SecondParameter<typeof customFetch>}

 ):  UseQueryResult<TData, TError> & { queryKey: QueryKey } {

  const queryOptions = getListConversationsQueryOptions(params,options)

  const query = useQuery(queryOptions) as  UseQueryResult<TData, TError> & { queryKey: QueryKey };

  return withQueryKey(query, queryOptions.queryKey);
}







export const getListMessagesUrl = (changaId: number,) => {




  return `/api/v1/chats/${changaId}/mensajes`
}

/**
 * @summary List messages for a job
 */
export const listMessages = async (changaId: number, options?: Parameters<typeof customFetch>[1]): Promise<ChatMessage[]> => {

  return customFetch<ChatMessage[]>(getListMessagesUrl(changaId),
  {
    ...options,
    method: 'GET'


  }
);}





export const getListMessagesQueryKey = (changaId: number,) => {
    return [
    `/api/v1/chats/${changaId}/mensajes`
    ] as const;
    }


export const getListMessagesQueryOptions = <TData = Awaited<ReturnType<typeof listMessages>>, TError = ErrorType<unknown>>(changaId: number, options?: { query?:UseQueryOptions<Awaited<ReturnType<typeof listMessages>>, TError, TData>, request?: SecondParameter<typeof customFetch>}
) => {

const {query: queryOptions, request: requestOptions} = options ?? {};

  const queryKey =  queryOptions?.queryKey ?? getListMessagesQueryKey(changaId);



    const queryFn: QueryFunction<Awaited<ReturnType<typeof listMessages>>> = ({ signal }) => listMessages(changaId, { signal, ...requestOptions });





   return  { queryKey, queryFn, enabled: changaId !== null && changaId !== undefined, ...queryOptions} as UseQueryOptions<Awaited<ReturnType<typeof listMessages>>, TError, TData> & { queryKey: QueryKey }
}

export type ListMessagesQueryResult = NonNullable<Awaited<ReturnType<typeof listMessages>>>
export type ListMessagesQueryError = ErrorType<unknown>


/**
 * @summary List messages for a job
 */

export function useListMessages<TData = Awaited<ReturnType<typeof listMessages>>, TError = ErrorType<unknown>>(
 changaId: number, options?: { query?:UseQueryOptions<Awaited<ReturnType<typeof listMessages>>, TError, TData>, request?: SecondParameter<typeof customFetch>}

 ):  UseQueryResult<TData, TError> & { queryKey: QueryKey } {

  const queryOptions = getListMessagesQueryOptions(changaId,options)

  const query = useQuery(queryOptions) as  UseQueryResult<TData, TError> & { queryKey: QueryKey };

  return withQueryKey(query, queryOptions.queryKey);
}







export const getCreateMessageUrl = (changaId: number,) => {




  return `/api/v1/chats/${changaId}/mensajes`
}

/**
 * @summary Send a message
 */
export const createMessage = async (changaId: number,
    messageInput: MessageInput, options?: Parameters<typeof customFetch>[1]): Promise<ChatMessage> => {

  return customFetch<ChatMessage>(getCreateMessageUrl(changaId),
  {
    ...options,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    body: JSON.stringify(messageInput)
  }
);}





export const getCreateMessageMutationOptions = <TError = ErrorType<unknown>,
    TContext = unknown>(options?: { mutation?:UseMutationOptions<Awaited<ReturnType<typeof createMessage>>, TError,{changaId: number;data: BodyType<MessageInput>}, TContext>, request?: SecondParameter<typeof customFetch>}
): UseMutationOptions<Awaited<ReturnType<typeof createMessage>>, TError,{changaId: number;data: BodyType<MessageInput>}, TContext> => {

const mutationKey = ['createMessage'];
const {mutation: mutationOptions, request: requestOptions} = options ?
      options.mutation && 'mutationKey' in options.mutation && options.mutation.mutationKey ?
      options
      : {...options, mutation: {...options.mutation, mutationKey}}
      : {mutation: { mutationKey, }, request: undefined};




      const mutationFn: MutationFunction<Awaited<ReturnType<typeof createMessage>>, {changaId: number;data: BodyType<MessageInput>}> = (props) => {
          const {changaId,data} = props ?? {};

          return  createMessage(changaId,data,requestOptions)
        }






  return  { mutationFn, ...mutationOptions }}

    export type CreateMessageMutationResult = NonNullable<Awaited<ReturnType<typeof createMessage>>>
    export type CreateMessageMutationBody = BodyType<MessageInput>
    export type CreateMessageMutationError = ErrorType<unknown>

    /**
 * @summary Send a message
 */
export const useCreateMessage = <TError = ErrorType<unknown>,
    TContext = unknown>(options?: { mutation?:UseMutationOptions<Awaited<ReturnType<typeof createMessage>>, TError,{changaId: number;data: BodyType<MessageInput>}, TContext>, request?: SecondParameter<typeof customFetch>}
 ): UseMutationResult<
        Awaited<ReturnType<typeof createMessage>>,
        TError,
        {changaId: number;data: BodyType<MessageInput>},
        TContext
      > => {
      return useMutation(getCreateMessageMutationOptions(options));
    }

export const getMarkMessagesReadUrl = (changaId: number,) => {




  return `/api/v1/chats/${changaId}/leidos`
}

/**
 * @summary Mark the other participant's messages as read
 */
export const markMessagesRead = async (changaId: number, options?: Parameters<typeof customFetch>[1]): Promise<void> => {

  return customFetch<void>(getMarkMessagesReadUrl(changaId),
  {
    ...options,
    method: 'POST'


  }
);}





export const getMarkMessagesReadMutationOptions = <TError = ErrorType<unknown>,
    TContext = unknown>(options?: { mutation?:UseMutationOptions<Awaited<ReturnType<typeof markMessagesRead>>, TError,{changaId: number}, TContext>, request?: SecondParameter<typeof customFetch>}
): UseMutationOptions<Awaited<ReturnType<typeof markMessagesRead>>, TError,{changaId: number}, TContext> => {

const mutationKey = ['markMessagesRead'];
const {mutation: mutationOptions, request: requestOptions} = options ?
      options.mutation && 'mutationKey' in options.mutation && options.mutation.mutationKey ?
      options
      : {...options, mutation: {...options.mutation, mutationKey}}
      : {mutation: { mutationKey, }, request: undefined};




      const mutationFn: MutationFunction<Awaited<ReturnType<typeof markMessagesRead>>, {changaId: number}> = (props) => {
          const {changaId} = props ?? {};

          return  markMessagesRead(changaId,requestOptions)
        }






  return  { mutationFn, ...mutationOptions }}

    export type MarkMessagesReadMutationResult = NonNullable<Awaited<ReturnType<typeof markMessagesRead>>>

    export type MarkMessagesReadMutationError = ErrorType<unknown>

    /**
 * @summary Mark the other participant's messages as read
 */
export const useMarkMessagesRead = <TError = ErrorType<unknown>,
    TContext = unknown>(options?: { mutation?:UseMutationOptions<Awaited<ReturnType<typeof markMessagesRead>>, TError,{changaId: number}, TContext>, request?: SecondParameter<typeof customFetch>}
 ): UseMutationResult<
        Awaited<ReturnType<typeof markMessagesRead>>,
        TError,
        {changaId: number},
        TContext
      > => {
      return useMutation(getMarkMessagesReadMutationOptions(options));
    }

export const getListAppointmentsUrl = (changaId: number,) => {




  return `/api/v1/chats/${changaId}/citas`
}

/**
 * @summary List appointments for a conversation
 */
export const listAppointments = async (changaId: number, options?: Parameters<typeof customFetch>[1]): Promise<Appointment[]> => {

  return customFetch<Appointment[]>(getListAppointmentsUrl(changaId),
  {
    ...options,
    method: 'GET'


  }
);}





export const getListAppointmentsQueryKey = (changaId: number,) => {
    return [
    `/api/v1/chats/${changaId}/citas`
    ] as const;
    }


export const getListAppointmentsQueryOptions = <TData = Awaited<ReturnType<typeof listAppointments>>, TError = ErrorType<void>>(changaId: number, options?: { query?:UseQueryOptions<Awaited<ReturnType<typeof listAppointments>>, TError, TData>, request?: SecondParameter<typeof customFetch>}
) => {

const {query: queryOptions, request: requestOptions} = options ?? {};

  const queryKey =  queryOptions?.queryKey ?? getListAppointmentsQueryKey(changaId);



    const queryFn: QueryFunction<Awaited<ReturnType<typeof listAppointments>>> = ({ signal }) => listAppointments(changaId, { signal, ...requestOptions });





   return  { queryKey, queryFn, enabled: changaId !== null && changaId !== undefined, ...queryOptions} as UseQueryOptions<Awaited<ReturnType<typeof listAppointments>>, TError, TData> & { queryKey: QueryKey }
}

export type ListAppointmentsQueryResult = NonNullable<Awaited<ReturnType<typeof listAppointments>>>
export type ListAppointmentsQueryError = ErrorType<void>


/**
 * @summary List appointments for a conversation
 */

export function useListAppointments<TData = Awaited<ReturnType<typeof listAppointments>>, TError = ErrorType<void>>(
 changaId: number, options?: { query?:UseQueryOptions<Awaited<ReturnType<typeof listAppointments>>, TError, TData>, request?: SecondParameter<typeof customFetch>}

 ):  UseQueryResult<TData, TError> & { queryKey: QueryKey } {

  const queryOptions = getListAppointmentsQueryOptions(changaId,options)

  const query = useQuery(queryOptions) as  UseQueryResult<TData, TError> & { queryKey: QueryKey };

  return withQueryKey(query, queryOptions.queryKey);
}







export const getProposeAppointmentUrl = (changaId: number,) => {




  return `/api/v1/chats/${changaId}/citas`
}

/**
 * @summary Propose an appointment in a conversation
 */
export const proposeAppointment = async (changaId: number,
    appointmentInput: AppointmentInput, options?: Parameters<typeof customFetch>[1]): Promise<Appointment> => {

  return customFetch<Appointment>(getProposeAppointmentUrl(changaId),
  {
    ...options,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    body: JSON.stringify(appointmentInput)
  }
);}





export const getProposeAppointmentMutationOptions = <TError = ErrorType<void>,
    TContext = unknown>(options?: { mutation?:UseMutationOptions<Awaited<ReturnType<typeof proposeAppointment>>, TError,{changaId: number;data: BodyType<AppointmentInput>}, TContext>, request?: SecondParameter<typeof customFetch>}
): UseMutationOptions<Awaited<ReturnType<typeof proposeAppointment>>, TError,{changaId: number;data: BodyType<AppointmentInput>}, TContext> => {

const mutationKey = ['proposeAppointment'];
const {mutation: mutationOptions, request: requestOptions} = options ?
      options.mutation && 'mutationKey' in options.mutation && options.mutation.mutationKey ?
      options
      : {...options, mutation: {...options.mutation, mutationKey}}
      : {mutation: { mutationKey, }, request: undefined};




      const mutationFn: MutationFunction<Awaited<ReturnType<typeof proposeAppointment>>, {changaId: number;data: BodyType<AppointmentInput>}> = (props) => {
          const {changaId,data} = props ?? {};

          return  proposeAppointment(changaId,data,requestOptions)
        }






  return  { mutationFn, ...mutationOptions }}

    export type ProposeAppointmentMutationResult = NonNullable<Awaited<ReturnType<typeof proposeAppointment>>>
    export type ProposeAppointmentMutationBody = BodyType<AppointmentInput>
    export type ProposeAppointmentMutationError = ErrorType<void>

    /**
 * @summary Propose an appointment in a conversation
 */
export const useProposeAppointment = <TError = ErrorType<void>,
    TContext = unknown>(options?: { mutation?:UseMutationOptions<Awaited<ReturnType<typeof proposeAppointment>>, TError,{changaId: number;data: BodyType<AppointmentInput>}, TContext>, request?: SecondParameter<typeof customFetch>}
 ): UseMutationResult<
        Awaited<ReturnType<typeof proposeAppointment>>,
        TError,
        {changaId: number;data: BodyType<AppointmentInput>},
        TContext
      > => {
      return useMutation(getProposeAppointmentMutationOptions(options));
    }

export const getListAppointmentAttemptsUrl = (changaId: number,) => {




  return `/api/v1/chats/${changaId}/historial-visitas`
}

/**
 * @summary List coordination attempts for a conversation
 */
export const listAppointmentAttempts = async (changaId: number, options?: Parameters<typeof customFetch>[1]): Promise<AppointmentAttempt[]> => {

  return customFetch<AppointmentAttempt[]>(getListAppointmentAttemptsUrl(changaId),
  {
    ...options,
    method: 'GET'


  }
);}





export const getListAppointmentAttemptsQueryKey = (changaId: number,) => {
    return [
    `/api/v1/chats/${changaId}/historial-visitas`
    ] as const;
    }


export const getListAppointmentAttemptsQueryOptions = <TData = Awaited<ReturnType<typeof listAppointmentAttempts>>, TError = ErrorType<void>>(changaId: number, options?: { query?:UseQueryOptions<Awaited<ReturnType<typeof listAppointmentAttempts>>, TError, TData>, request?: SecondParameter<typeof customFetch>}
) => {

const {query: queryOptions, request: requestOptions} = options ?? {};

  const queryKey =  queryOptions?.queryKey ?? getListAppointmentAttemptsQueryKey(changaId);



    const queryFn: QueryFunction<Awaited<ReturnType<typeof listAppointmentAttempts>>> = ({ signal }) => listAppointmentAttempts(changaId, { signal, ...requestOptions });





   return  { queryKey, queryFn, enabled: changaId !== null && changaId !== undefined, ...queryOptions} as UseQueryOptions<Awaited<ReturnType<typeof listAppointmentAttempts>>, TError, TData> & { queryKey: QueryKey }
}

export type ListAppointmentAttemptsQueryResult = NonNullable<Awaited<ReturnType<typeof listAppointmentAttempts>>>
export type ListAppointmentAttemptsQueryError = ErrorType<void>


/**
 * @summary List coordination attempts for a conversation
 */

export function useListAppointmentAttempts<TData = Awaited<ReturnType<typeof listAppointmentAttempts>>, TError = ErrorType<void>>(
 changaId: number, options?: { query?:UseQueryOptions<Awaited<ReturnType<typeof listAppointmentAttempts>>, TError, TData>, request?: SecondParameter<typeof customFetch>}

 ):  UseQueryResult<TData, TError> & { queryKey: QueryKey } {

  const queryOptions = getListAppointmentAttemptsQueryOptions(changaId,options)

  const query = useQuery(queryOptions) as  UseQueryResult<TData, TError> & { queryKey: QueryKey };

  return withQueryKey(query, queryOptions.queryKey);
}







export const getLogAppointmentAttemptUrl = (changaId: number,) => {




  return `/api/v1/chats/${changaId}/historial-visitas`
}

/**
 * @summary Log a coordination attempt outcome
 */
export const logAppointmentAttempt = async (changaId: number,
    appointmentAttemptInput: AppointmentAttemptInput, options?: Parameters<typeof customFetch>[1]): Promise<AppointmentAttempt> => {

  return customFetch<AppointmentAttempt>(getLogAppointmentAttemptUrl(changaId),
  {
    ...options,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    body: JSON.stringify(appointmentAttemptInput)
  }
);}





export const getLogAppointmentAttemptMutationOptions = <TError = ErrorType<void>,
    TContext = unknown>(options?: { mutation?:UseMutationOptions<Awaited<ReturnType<typeof logAppointmentAttempt>>, TError,{changaId: number;data: BodyType<AppointmentAttemptInput>}, TContext>, request?: SecondParameter<typeof customFetch>}
): UseMutationOptions<Awaited<ReturnType<typeof logAppointmentAttempt>>, TError,{changaId: number;data: BodyType<AppointmentAttemptInput>}, TContext> => {

const mutationKey = ['logAppointmentAttempt'];
const {mutation: mutationOptions, request: requestOptions} = options ?
      options.mutation && 'mutationKey' in options.mutation && options.mutation.mutationKey ?
      options
      : {...options, mutation: {...options.mutation, mutationKey}}
      : {mutation: { mutationKey, }, request: undefined};




      const mutationFn: MutationFunction<Awaited<ReturnType<typeof logAppointmentAttempt>>, {changaId: number;data: BodyType<AppointmentAttemptInput>}> = (props) => {
          const {changaId,data} = props ?? {};

          return  logAppointmentAttempt(changaId,data,requestOptions)
        }






  return  { mutationFn, ...mutationOptions }}

    export type LogAppointmentAttemptMutationResult = NonNullable<Awaited<ReturnType<typeof logAppointmentAttempt>>>
    export type LogAppointmentAttemptMutationBody = BodyType<AppointmentAttemptInput>
    export type LogAppointmentAttemptMutationError = ErrorType<void>

    /**
 * @summary Log a coordination attempt outcome
 */
export const useLogAppointmentAttempt = <TError = ErrorType<void>,
    TContext = unknown>(options?: { mutation?:UseMutationOptions<Awaited<ReturnType<typeof logAppointmentAttempt>>, TError,{changaId: number;data: BodyType<AppointmentAttemptInput>}, TContext>, request?: SecondParameter<typeof customFetch>}
 ): UseMutationResult<
        Awaited<ReturnType<typeof logAppointmentAttempt>>,
        TError,
        {changaId: number;data: BodyType<AppointmentAttemptInput>},
        TContext
      > => {
      return useMutation(getLogAppointmentAttemptMutationOptions(options));
    }

export const getAcceptAppointmentUrl = (id: number,) => {




  return `/api/v1/citas/${id}/aceptar`
}

/**
 * @summary Accept an appointment
 */
export const acceptAppointment = async (id: number, options?: Parameters<typeof customFetch>[1]): Promise<Appointment> => {

  return customFetch<Appointment>(getAcceptAppointmentUrl(id),
  {
    ...options,
    method: 'POST'


  }
);}





export const getAcceptAppointmentMutationOptions = <TError = ErrorType<void>,
    TContext = unknown>(options?: { mutation?:UseMutationOptions<Awaited<ReturnType<typeof acceptAppointment>>, TError,{id: number}, TContext>, request?: SecondParameter<typeof customFetch>}
): UseMutationOptions<Awaited<ReturnType<typeof acceptAppointment>>, TError,{id: number}, TContext> => {

const mutationKey = ['acceptAppointment'];
const {mutation: mutationOptions, request: requestOptions} = options ?
      options.mutation && 'mutationKey' in options.mutation && options.mutation.mutationKey ?
      options
      : {...options, mutation: {...options.mutation, mutationKey}}
      : {mutation: { mutationKey, }, request: undefined};




      const mutationFn: MutationFunction<Awaited<ReturnType<typeof acceptAppointment>>, {id: number}> = (props) => {
          const {id} = props ?? {};

          return  acceptAppointment(id,requestOptions)
        }






  return  { mutationFn, ...mutationOptions }}

    export type AcceptAppointmentMutationResult = NonNullable<Awaited<ReturnType<typeof acceptAppointment>>>

    export type AcceptAppointmentMutationError = ErrorType<void>

    /**
 * @summary Accept an appointment
 */
export const useAcceptAppointment = <TError = ErrorType<void>,
    TContext = unknown>(options?: { mutation?:UseMutationOptions<Awaited<ReturnType<typeof acceptAppointment>>, TError,{id: number}, TContext>, request?: SecondParameter<typeof customFetch>}
 ): UseMutationResult<
        Awaited<ReturnType<typeof acceptAppointment>>,
        TError,
        {id: number},
        TContext
      > => {
      return useMutation(getAcceptAppointmentMutationOptions(options));
    }

export const getRejectAppointmentUrl = (id: number,) => {




  return `/api/v1/citas/${id}/rechazar`
}

/**
 * @summary Reject an appointment
 */
export const rejectAppointment = async (id: number, options?: Parameters<typeof customFetch>[1]): Promise<Appointment> => {

  return customFetch<Appointment>(getRejectAppointmentUrl(id),
  {
    ...options,
    method: 'POST'


  }
);}





export const getRejectAppointmentMutationOptions = <TError = ErrorType<void>,
    TContext = unknown>(options?: { mutation?:UseMutationOptions<Awaited<ReturnType<typeof rejectAppointment>>, TError,{id: number}, TContext>, request?: SecondParameter<typeof customFetch>}
): UseMutationOptions<Awaited<ReturnType<typeof rejectAppointment>>, TError,{id: number}, TContext> => {

const mutationKey = ['rejectAppointment'];
const {mutation: mutationOptions, request: requestOptions} = options ?
      options.mutation && 'mutationKey' in options.mutation && options.mutation.mutationKey ?
      options
      : {...options, mutation: {...options.mutation, mutationKey}}
      : {mutation: { mutationKey, }, request: undefined};




      const mutationFn: MutationFunction<Awaited<ReturnType<typeof rejectAppointment>>, {id: number}> = (props) => {
          const {id} = props ?? {};

          return  rejectAppointment(id,requestOptions)
        }






  return  { mutationFn, ...mutationOptions }}

    export type RejectAppointmentMutationResult = NonNullable<Awaited<ReturnType<typeof rejectAppointment>>>

    export type RejectAppointmentMutationError = ErrorType<void>

    /**
 * @summary Reject an appointment
 */
export const useRejectAppointment = <TError = ErrorType<void>,
    TContext = unknown>(options?: { mutation?:UseMutationOptions<Awaited<ReturnType<typeof rejectAppointment>>, TError,{id: number}, TContext>, request?: SecondParameter<typeof customFetch>}
 ): UseMutationResult<
        Awaited<ReturnType<typeof rejectAppointment>>,
        TError,
        {id: number},
        TContext
      > => {
      return useMutation(getRejectAppointmentMutationOptions(options));
    }

