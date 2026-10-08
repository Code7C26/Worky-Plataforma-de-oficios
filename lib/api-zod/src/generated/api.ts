  "cantidadChangas": zod.number(),
  "createdAt": zod.string(),
  "updatedAt": zod.string(),
  "usuario": zod.object({
  "id": zod.number(),
  "nombre": zod.string(),
  "fotoObjectPath": zod.string().nullish(),
  "rol": zod.enum(['cliente', 'profesional', 'admin']),
  "ubicacion": zod.union([zod.object({
  "ciudad": zod.string().optional(),
  "zona": zod.string().optional()
}),zod.null()]).optional()
}),
  "reviewsCount": zod.number(),
  "completedJobs": zod.number(),
  "recommendationsCount": zod.number(),
  "distanceKm": zod.number().nullish().describe('Distancia aproximada en kilómetros; es null cuando la ubicación del profesional no tiene un heartbeat vigente (máximo 5 minutos).')
})
export const ListProfessionalsResponse = zod.array(ListProfessionalsResponseItem)


/**
 * @summary Get a professional
 */
export const GetProfessionalParams = zod.object({
  "id": zod.coerce.number()
})

export const GetProfessionalResponse = zod.object({
  "id": zod.number(),
  "usuarioId": zod.number(),
  "oficio": zod.string(),
  "categoria": zod.string(),
  "matriculaHabilitante": zod.string().nullish(),
  "verificado": zod.boolean(),
  "estadoVerificacion": zod.enum(['pending_verification', 'verified', 'rejected']),
  "skills": zod.array(zod.string()),
  "about": zod.string().nullish(),
  "experienciaAnios": zod.number(),
  "precioReferencia": zod.number(),
  "disponible": zod.boolean(),
  "rating": zod.number(),
  "cantidadChangas": zod.number(),
  "createdAt": zod.string(),
  "updatedAt": zod.string(),
  "usuario": zod.object({
  "id": zod.number(),
  "nombre": zod.string(),
  "fotoObjectPath": zod.string().nullish(),
  "rol": zod.enum(['cliente', 'profesional', 'admin']),
  "ubicacion": zod.union([zod.object({
  "ciudad": zod.string().optional(),
  "zona": zod.string().optional()
}),zod.null()]).optional()
}),
  "reviewsCount": zod.number(),
  "completedJobs": zod.number(),
  "recommendationsCount": zod.number(),
  "distanceKm": zod.number().nullish().describe('Distancia aproximada en kilómetros; es null cuando la ubicación del profesional no tiene un heartbeat vigente (máximo 5 minutos).')
})


/**
 * @summary Get a professional reputation
 */
export const GetProfessionalReputationParams = zod.object({
  "id": zod.coerce.number()
})

export const GetProfessionalReputationResponse = zod.object({
  "rating": zod.number(),
  "reviewsCount": zod.number(),
  "recommendationsCount": zod.number(),
  "completedJobs": zod.number(),
  "reviews": zod.array(zod.object({
  "id": zod.number(),
  "rating": zod.number(),
  "comentario": zod.string().nullish(),
  "adjuntos": zod.array(zod.object({
  "objectPath": zod.string(),
  "nombre": zod.string(),
  "contentType": zod.string(),
  "sizeBytes": zod.number()
})),
  "autor": zod.object({
  "id": zod.number(),
  "nombre": zod.string()
})
})),
  "recommendations": zod.array(zod.object({
  "id": zod.number(),
  "comentario": zod.string().nullish(),
  "autor": zod.object({
  "id": zod.number(),
  "nombre": zod.string()
})
}))
})


/**
 * @summary Create the current user's professional profile
 */
export const createMyProfessionalProfileBodyOficioMin = 2;

export const createMyProfessionalProfileBodyPrecioReferenciaMin = 0;

export const createMyProfessionalProfileBodyExperienciaAniosMin = 0;



export const CreateMyProfessionalProfileBody = zod.object({
  "oficio": zod.string().min(createMyProfessionalProfileBodyOficioMin),
  "categoria": zod.string(),
  "precioReferencia": zod.number().min(createMyProfessionalProfileBodyPrecioReferenciaMin),
  "experienciaAnios": zod.number().min(createMyProfessionalProfileBodyExperienciaAniosMin).optional(),
  "about": zod.string().nullish(),
  "skills": zod.array(zod.string()).optional(),
  "disponible": zod.boolean().optional(),
  "matriculaHabilitante": zod.string().nullish()
})

export const CreateMyProfessionalProfileResponse = zod.object({
  "id": zod.number(),
  "usuarioId": zod.number(),
  "oficio": zod.string(),
  "categoria": zod.string(),
  "matriculaHabilitante": zod.string().nullish(),
  "verificado": zod.boolean(),
  "estadoVerificacion": zod.enum(['pending_verification', 'verified', 'rejected']),
  "skills": zod.array(zod.string()),
  "about": zod.string().nullish(),
  "experienciaAnios": zod.number(),
  "precioReferencia": zod.number(),
  "disponible": zod.boolean(),
  "rating": zod.number(),
  "cantidadChangas": zod.number(),
  "createdAt": zod.string(),
  "updatedAt": zod.string(),
  "usuario": zod.object({
  "id": zod.number(),
  "nombre": zod.string(),
  "fotoObjectPath": zod.string().nullish(),
  "rol": zod.enum(['cliente', 'profesional', 'admin']),
  "ubicacion": zod.union([zod.object({
  "ciudad": zod.string().optional(),
  "zona": zod.string().optional()
}),zod.null()]).optional()
}),
  "reviewsCount": zod.number(),
  "completedJobs": zod.number(),
  "recommendationsCount": zod.number(),
  "distanceKm": zod.number().nullish().describe('Distancia aproximada en kilómetros; es null cuando la ubicación del profesional no tiene un heartbeat vigente (máximo 5 minutos).')
})


/**
 * @summary Get current professional profile
 */
export const GetMyProfessionalProfileResponse = zod.union([zod.object({
  "id": zod.number(),
  "usuarioId": zod.number(),
  "oficio": zod.string(),
  "categoria": zod.string(),
  "matriculaHabilitante": zod.string().nullish(),
  "verificado": zod.boolean(),
  "estadoVerificacion": zod.enum(['pending_verification', 'verified', 'rejected']),
  "skills": zod.array(zod.string()),
  "about": zod.string().nullish(),
  "experienciaAnios": zod.number(),
  "precioReferencia": zod.number(),
  "disponible": zod.boolean(),
  "rating": zod.number(),
  "cantidadChangas": zod.number(),
  "createdAt": zod.string(),
  "updatedAt": zod.string(),
  "usuario": zod.object({
  "id": zod.number(),
  "nombre": zod.string(),
  "fotoObjectPath": zod.string().nullish(),
  "rol": zod.enum(['cliente', 'profesional', 'admin']),
  "ubicacion": zod.union([zod.object({
  "ciudad": zod.string().optional(),
  "zona": zod.string().optional()
}),zod.null()]).optional()
}),
  "reviewsCount": zod.number(),
  "completedJobs": zod.number(),
  "recommendationsCount": zod.number(),
  "distanceKm": zod.number().nullish().describe('Distancia aproximada en kilómetros; es null cuando la ubicación del profesional no tiene un heartbeat vigente (máximo 5 minutos).')
}),zod.null()])


/**
 * @summary Update current professional profile
 */
export const updateMyProfessionalProfileBodyOficioMin = 2;

export const updateMyProfessionalProfileBodyPrecioReferenciaMin = 0;

export const updateMyProfessionalProfileBodyExperienciaAniosMin = 0;



export const UpdateMyProfessionalProfileBody = zod.object({
  "oficio": zod.string().min(updateMyProfessionalProfileBodyOficioMin),
  "categoria": zod.string(),
  "precioReferencia": zod.number().min(updateMyProfessionalProfileBodyPrecioReferenciaMin),
  "experienciaAnios": zod.number().min(updateMyProfessionalProfileBodyExperienciaAniosMin).optional(),
  "about": zod.string().nullish(),
  "skills": zod.array(zod.string()).optional(),
  "disponible": zod.boolean().optional(),
  "matriculaHabilitante": zod.string().nullish()
})

export const UpdateMyProfessionalProfileResponse = zod.object({
  "id": zod.number(),
  "usuarioId": zod.number(),
  "oficio": zod.string(),
  "categoria": zod.string(),
  "matriculaHabilitante": zod.string().nullish(),
  "verificado": zod.boolean(),
  "estadoVerificacion": zod.enum(['pending_verification', 'verified', 'rejected']),
  "skills": zod.array(zod.string()),
  "about": zod.string().nullish(),
  "experienciaAnios": zod.number(),
  "precioReferencia": zod.number(),
  "disponible": zod.boolean(),
  "rating": zod.number(),
  "cantidadChangas": zod.number(),
  "createdAt": zod.string(),
  "updatedAt": zod.string(),
  "usuario": zod.object({
  "id": zod.number(),
  "nombre": zod.string(),
  "fotoObjectPath": zod.string().nullish(),
  "rol": zod.enum(['cliente', 'profesional', 'admin']),
  "ubicacion": zod.union([zod.object({
  "ciudad": zod.string().optional(),
  "zona": zod.string().optional()
}),zod.null()]).optional()
}),
  "reviewsCount": zod.number(),
  "completedJobs": zod.number(),
  "recommendationsCount": zod.number(),
  "distanceKm": zod.number().nullish().describe('Distancia aproximada en kilómetros; es null cuando la ubicación del profesional no tiene un heartbeat vigente (máximo 5 minutos).')
})


/**
 * @summary Publish or directly assign a job
 */
export const createJobBodyCategoriaMin = 2;

export const createJobBodyPrecioOfrecidoMin = 0;

export const createJobBodyDetalleMin = 3;



export const CreateJobBody = zod.object({
  "ubicacion": zod.object({
  "direccionTexto": zod.string().optional(),
  "ciudad": zod.string().optional(),
  "provincia": zod.string().optional(),
  "zona": zod.string().optional(),
  "capturedAt": zod.coerce.date().nullish(),
  "coordinates": zod.array(zod.number()).optional()
}),
  "categoria": zod.string().min(createJobBodyCategoriaMin),
  "precioOfrecido": zod.number().min(createJobBodyPrecioOfrecidoMin),
  "detalle": zod.string().min(createJobBodyDetalleMin).nullish(),
  "profesionalId": zod.number().nullish()
})

export const CreateJobResponse = zod.object({
  "id": zod.number(),
  "clienteId": zod.number(),
  "profesionalId": zod.number().nullable(),
  "ubicacion": zod.object({
  "direccionTexto": zod.string().optional(),
  "ciudad": zod.string().optional(),
  "provincia": zod.string().optional(),
  "zona": zod.string().optional(),
  "capturedAt": zod.coerce.date().nullish(),
  "coordinates": zod.array(zod.number()).optional()
}),
  "categoria": zod.string(),
  "precioOfrecido": zod.number(),
  "detalle": zod.string().nullable(),
  "estado": zod.enum(['publicada', 'aceptada', 'en_curso', 'finalizada', 'cancelada']),
  "createdAt": zod.string(),
  "updatedAt": zod.string(),
  "cliente": zod.object({
  "id": zod.number(),
  "nombre": zod.string(),
  "email": zod.string(),
  "telefono": zod.string().nullish(),
  "fotoObjectPath": zod.string().nullish(),
  "rol": zod.enum(['cliente', 'profesional', 'admin']),
  "ubicacion": zod.union([zod.object({
  "direccionTexto": zod.string().optional(),
  "ciudad": zod.string().optional(),
  "provincia": zod.string().optional(),
  "zona": zod.string().optional(),
  "capturedAt": zod.coerce.date().nullish(),
  "coordinates": zod.array(zod.number()).optional()
}),zod.null()]).optional()
}),
  "profesional": zod.union([zod.object({
  "id": zod.number(),
  "nombre": zod.string(),
  "email": zod.string(),
  "telefono": zod.string().nullish(),
  "fotoObjectPath": zod.string().nullish(),
  "rol": zod.enum(['cliente', 'profesional', 'admin']),
  "ubicacion": zod.union([zod.object({
  "direccionTexto": zod.string().optional(),
  "ciudad": zod.string().optional(),
  "provincia": zod.string().optional(),
  "zona": zod.string().optional(),
  "capturedAt": zod.coerce.date().nullish(),
  "coordinates": zod.array(zod.number()).optional()
}),zod.null()]).optional()
}),zod.null()]),
  "calificada": zod.boolean()
})


/**
 * @summary List jobs created by the current user
 */
export const ListMyJobsResponseItem = zod.object({
  "id": zod.number(),
  "clienteId": zod.number(),
  "profesionalId": zod.number().nullable(),
  "ubicacion": zod.object({
  "direccionTexto": zod.string().optional(),
  "ciudad": zod.string().optional(),
  "provincia": zod.string().optional(),
  "zona": zod.string().optional(),
  "capturedAt": zod.coerce.date().nullish(),
  "coordinates": zod.array(zod.number()).optional()
}),
  "categoria": zod.string(),
  "precioOfrecido": zod.number(),
  "detalle": zod.string().nullable(),
  "estado": zod.enum(['publicada', 'aceptada', 'en_curso', 'finalizada', 'cancelada']),
  "createdAt": zod.string(),
  "updatedAt": zod.string(),
  "cliente": zod.object({
  "id": zod.number(),
  "nombre": zod.string(),
  "email": zod.string(),
  "telefono": zod.string().nullish(),
  "fotoObjectPath": zod.string().nullish(),
  "rol": zod.enum(['cliente', 'profesional', 'admin']),
  "ubicacion": zod.union([zod.object({
  "direccionTexto": zod.string().optional(),
  "ciudad": zod.string().optional(),
  "provincia": zod.string().optional(),
  "zona": zod.string().optional(),
  "capturedAt": zod.coerce.date().nullish(),
  "coordinates": zod.array(zod.number()).optional()
}),zod.null()]).optional()
}),
  "profesional": zod.union([zod.object({
  "id": zod.number(),
  "nombre": zod.string(),
  "email": zod.string(),
  "telefono": zod.string().nullish(),
  "fotoObjectPath": zod.string().nullish(),
  "rol": zod.enum(['cliente', 'profesional', 'admin']),
  "ubicacion": zod.union([zod.object({
  "direccionTexto": zod.string().optional(),
  "ciudad": zod.string().optional(),
  "provincia": zod.string().optional(),
  "zona": zod.string().optional(),
  "capturedAt": zod.coerce.date().nullish(),
  "coordinates": zod.array(zod.number()).optional()
}),zod.null()]).optional()
}),zod.null()]),
  "calificada": zod.boolean()
})
export const ListMyJobsResponse = zod.array(ListMyJobsResponseItem)


/**
 * @summary List jobs available to the current professional
 */
export const ListAvailableJobsResponseItem = zod.object({
  "id": zod.number(),
  "clienteId": zod.number(),
  "profesionalId": zod.number().nullable(),
  "ubicacion": zod.object({
  "direccionTexto": zod.string().optional(),
  "ciudad": zod.string().optional(),
  "provincia": zod.string().optional(),
  "zona": zod.string().optional(),
  "capturedAt": zod.coerce.date().nullish(),
  "coordinates": zod.array(zod.number()).optional()
}),
  "categoria": zod.string(),
  "precioOfrecido": zod.number(),
  "detalle": zod.string().nullable(),
  "estado": zod.enum(['publicada', 'aceptada', 'en_curso', 'finalizada', 'cancelada']),
  "createdAt": zod.string(),
  "updatedAt": zod.string(),
  "cliente": zod.object({
  "id": zod.number(),
  "nombre": zod.string(),
  "email": zod.string(),
  "telefono": zod.string().nullish(),
  "fotoObjectPath": zod.string().nullish(),
  "rol": zod.enum(['cliente', 'profesional', 'admin']),
  "ubicacion": zod.union([zod.object({
  "direccionTexto": zod.string().optional(),
  "ciudad": zod.string().optional(),
  "provincia": zod.string().optional(),
  "zona": zod.string().optional(),
  "capturedAt": zod.coerce.date().nullish(),
  "coordinates": zod.array(zod.number()).optional()
}),zod.null()]).optional()
}),
  "profesional": zod.union([zod.object({
  "id": zod.number(),
  "nombre": zod.string(),
  "email": zod.string(),
  "telefono": zod.string().nullish(),
  "fotoObjectPath": zod.string().nullish(),
  "rol": zod.enum(['cliente', 'profesional', 'admin']),
  "ubicacion": zod.union([zod.object({
  "direccionTexto": zod.string().optional(),
  "ciudad": zod.string().optional(),
  "provincia": zod.string().optional(),
  "zona": zod.string().optional(),
  "capturedAt": zod.coerce.date().nullish(),
  "coordinates": zod.array(zod.number()).optional()
}),zod.null()]).optional()
}),zod.null()]),
  "calificada": zod.boolean()
})
export const ListAvailableJobsResponse = zod.array(ListAvailableJobsResponseItem)


/**
 * @summary List jobs assigned to the current professional
 */
export const ListAssignedJobsResponseItem = zod.object({
  "id": zod.number(),
  "clienteId": zod.number(),
  "profesionalId": zod.number().nullable(),
  "ubicacion": zod.object({
  "direccionTexto": zod.string().optional(),
  "ciudad": zod.string().optional(),
  "provincia": zod.string().optional(),
  "zona": zod.string().optional(),
  "capturedAt": zod.coerce.date().nullish(),
  "coordinates": zod.array(zod.number()).optional()
}),
  "categoria": zod.string(),
  "precioOfrecido": zod.number(),
  "detalle": zod.string().nullable(),
  "estado": zod.enum(['publicada', 'aceptada', 'en_curso', 'finalizada', 'cancelada']),
  "createdAt": zod.string(),
  "updatedAt": zod.string(),
  "cliente": zod.object({
  "id": zod.number(),
  "nombre": zod.string(),
  "email": zod.string(),
  "telefono": zod.string().nullish(),
  "fotoObjectPath": zod.string().nullish(),
  "rol": zod.enum(['cliente', 'profesional', 'admin']),
  "ubicacion": zod.union([zod.object({
  "direccionTexto": zod.string().optional(),
  "ciudad": zod.string().optional(),
  "provincia": zod.string().optional(),
  "zona": zod.string().optional(),
  "capturedAt": zod.coerce.date().nullish(),
  "coordinates": zod.array(zod.number()).optional()
}),zod.null()]).optional()
}),
  "profesional": zod.union([zod.object({
  "id": zod.number(),
  "nombre": zod.string(),
  "email": zod.string(),
  "telefono": zod.string().nullish(),
  "fotoObjectPath": zod.string().nullish(),
  "rol": zod.enum(['cliente', 'profesional', 'admin']),
  "ubicacion": zod.union([zod.object({
  "direccionTexto": zod.string().optional(),
  "ciudad": zod.string().optional(),
  "provincia": zod.string().optional(),
  "zona": zod.string().optional(),
  "capturedAt": zod.coerce.date().nullish(),
  "coordinates": zod.array(zod.number()).optional()
}),zod.null()]).optional()
}),zod.null()]),
  "calificada": zod.boolean()
})
export const ListAssignedJobsResponse = zod.array(ListAssignedJobsResponseItem)


/**
 * @summary Get a job
 */
export const GetJobParams = zod.object({
  "id": zod.coerce.number()
})

export const GetJobResponse = zod.object({
  "id": zod.number(),
  "clienteId": zod.number(),
  "profesionalId": zod.number().nullable(),
  "ubicacion": zod.object({
  "direccionTexto": zod.string().optional(),
  "ciudad": zod.string().optional(),
  "provincia": zod.string().optional(),
  "zona": zod.string().optional(),
  "capturedAt": zod.coerce.date().nullish(),
  "coordinates": zod.array(zod.number()).optional()
}),
  "categoria": zod.string(),
  "precioOfrecido": zod.number(),
  "detalle": zod.string().nullable(),
  "estado": zod.enum(['publicada', 'aceptada', 'en_curso', 'finalizada', 'cancelada']),
  "createdAt": zod.string(),
  "updatedAt": zod.string(),
  "cliente": zod.object({
  "id": zod.number(),
  "nombre": zod.string(),
  "email": zod.string(),
  "telefono": zod.string().nullish(),
  "fotoObjectPath": zod.string().nullish(),
  "rol": zod.enum(['cliente', 'profesional', 'admin']),
  "ubicacion": zod.union([zod.object({
  "direccionTexto": zod.string().optional(),
  "ciudad": zod.string().optional(),
  "provincia": zod.string().optional(),
  "zona": zod.string().optional(),
  "capturedAt": zod.coerce.date().nullish(),
  "coordinates": zod.array(zod.number()).optional()
}),zod.null()]).optional()
}),
  "profesional": zod.union([zod.object({
  "id": zod.number(),
  "nombre": zod.string(),
  "email": zod.string(),
  "telefono": zod.string().nullish(),
  "fotoObjectPath": zod.string().nullish(),
  "rol": zod.enum(['cliente', 'profesional', 'admin']),
  "ubicacion": zod.union([zod.object({
  "direccionTexto": zod.string().optional(),
  "ciudad": zod.string().optional(),
  "provincia": zod.string().optional(),
  "zona": zod.string().optional(),
  "capturedAt": zod.coerce.date().nullish(),
  "coordinates": zod.array(zod.number()).optional()
}),zod.null()]).optional()
}),zod.null()]),
  "calificada": zod.boolean()
})


/**
 * @summary Update job state
 */
export const UpdateJobParams = zod.object({
  "id": zod.coerce.number()
})

export const UpdateJobBody = zod.object({
  "estado": zod.enum(['publicada', 'aceptada', 'en_curso', 'finalizada', 'cancelada'])
})

export const UpdateJobResponse = zod.object({
  "id": zod.number(),
  "clienteId": zod.number(),
  "profesionalId": zod.number().nullable(),
  "ubicacion": zod.object({
  "direccionTexto": zod.string().optional(),
  "ciudad": zod.string().optional(),
  "provincia": zod.string().optional(),
  "zona": zod.string().optional(),
  "capturedAt": zod.coerce.date().nullish(),
  "coordinates": zod.array(zod.number()).optional()
}),
  "categoria": zod.string(),
  "precioOfrecido": zod.number(),
  "detalle": zod.string().nullable(),
  "estado": zod.enum(['publicada', 'aceptada', 'en_curso', 'finalizada', 'cancelada']),
  "createdAt": zod.string(),
  "updatedAt": zod.string(),
  "cliente": zod.object({
  "id": zod.number(),
  "nombre": zod.string(),
  "email": zod.string(),
  "telefono": zod.string().nullish(),
  "fotoObjectPath": zod.string().nullish(),
  "rol": zod.enum(['cliente', 'profesional', 'admin']),
  "ubicacion": zod.union([zod.object({
  "direccionTexto": zod.string().optional(),
  "ciudad": zod.string().optional(),
  "provincia": zod.string().optional(),
  "zona": zod.string().optional(),
  "capturedAt": zod.coerce.date().nullish(),
  "coordinates": zod.array(zod.number()).optional()
}),zod.null()]).optional()
}),
  "profesional": zod.union([zod.object({
  "id": zod.number(),
  "nombre": zod.string(),
  "email": zod.string(),
  "telefono": zod.string().nullish(),
  "fotoObjectPath": zod.string().nullish(),
  "rol": zod.enum(['cliente', 'profesional', 'admin']),
  "ubicacion": zod.union([zod.object({
  "direccionTexto": zod.string().optional(),
  "ciudad": zod.string().optional(),
  "provincia": zod.string().optional(),
  "zona": zod.string().optional(),
  "capturedAt": zod.coerce.date().nullish(),
  "coordinates": zod.array(zod.number()).optional()
}),zod.null()]).optional()
}),zod.null()]),
  "calificada": zod.boolean()
})


/**
 * @summary Accept an available job
 */
export const AcceptJobParams = zod.object({
  "id": zod.coerce.number()
})

export const AcceptJobResponse = zod.object({
  "id": zod.number(),
  "clienteId": zod.number(),
  "profesionalId": zod.number().nullable(),
  "ubicacion": zod.object({
  "direccionTexto": zod.string().optional(),
  "ciudad": zod.string().optional(),
  "provincia": zod.string().optional(),
  "zona": zod.string().optional(),
  "capturedAt": zod.coerce.date().nullish(),
  "coordinates": zod.array(zod.number()).optional()
}),
  "categoria": zod.string(),
  "precioOfrecido": zod.number(),
  "detalle": zod.string().nullable(),
  "estado": zod.enum(['publicada', 'aceptada', 'en_curso', 'finalizada', 'cancelada']),
  "createdAt": zod.string(),
  "updatedAt": zod.string(),
  "cliente": zod.object({
  "id": zod.number(),
  "nombre": zod.string(),
  "email": zod.string(),
  "telefono": zod.string().nullish(),
  "fotoObjectPath": zod.string().nullish(),
  "rol": zod.enum(['cliente', 'profesional', 'admin']),
  "ubicacion": zod.union([zod.object({
  "direccionTexto": zod.string().optional(),
  "ciudad": zod.string().optional(),
  "provincia": zod.string().optional(),
  "zona": zod.string().optional(),
  "capturedAt": zod.coerce.date().nullish(),
  "coordinates": zod.array(zod.number()).optional()
}),zod.null()]).optional()
}),
  "profesional": zod.union([zod.object({
  "id": zod.number(),
  "nombre": zod.string(),
  "email": zod.string(),
  "telefono": zod.string().nullish(),
  "fotoObjectPath": zod.string().nullish(),
  "rol": zod.enum(['cliente', 'profesional', 'admin']),
  "ubicacion": zod.union([zod.object({
  "direccionTexto": zod.string().optional(),
  "ciudad": zod.string().optional(),
  "provincia": zod.string().optional(),
  "zona": zod.string().optional(),
  "capturedAt": zod.coerce.date().nullish(),
  "coordinates": zod.array(zod.number()).optional()
}),zod.null()]).optional()
}),zod.null()]),
  "calificada": zod.boolean()
})


/**
 * @summary List the current user's conversations
 */
export const ListConversationsQueryParams = zod.object({
  "rol": zod.enum(['cliente', 'profesional']).optional()
})

export const ListConversationsResponseItem = zod.object({
  "changaId": zod.number(),
  "estado": zod.enum(['publicada', 'aceptada', 'en_curso', 'finalizada', 'cancelada']),
  "categoria": zod.string(),
  "detalle": zod.string().nullable(),
  "updatedAt": zod.string(),
  "unread": zod.number(),
  "interlocutor": zod.union([zod.object({
  "id": zod.number(),
  "nombre": zod.string(),
  "email": zod.string(),
  "telefono": zod.string().nullish(),
  "fotoObjectPath": zod.string().nullish(),
  "rol": zod.enum(['cliente', 'profesional', 'admin']),
  "ubicacion": zod.union([zod.object({
  "direccionTexto": zod.string().optional(),
  "ciudad": zod.string().optional(),
  "provincia": zod.string().optional(),
  "zona": zod.string().optional(),
  "capturedAt": zod.coerce.date().nullish(),
  "coordinates": zod.array(zod.number()).optional()
}),zod.null()]).optional()
}),zod.null()]),
  "ultimoMensaje": zod.union([zod.object({
  "id": zod.number(),
  "changaId": zod.number(),
  "emisorId": zod.number(),
  "texto": zod.string(),
  "adjuntos": zod.array(zod.object({
  "objectPath": zod.string(),
  "nombre": zod.string().optional()
})),
  "leido": zod.boolean(),
  "createdAt": zod.string(),
  "emisor": zod.object({
  "id": zod.number(),
  "nombre": zod.string(),
  "email": zod.string(),
  "telefono": zod.string().nullish(),
  "fotoObjectPath": zod.string().nullish(),
  "rol": zod.enum(['cliente', 'profesional', 'admin']),
  "ubicacion": zod.union([zod.object({
  "direccionTexto": zod.string().optional(),
  "ciudad": zod.string().optional(),
  "provincia": zod.string().optional(),
  "zona": zod.string().optional(),
  "capturedAt": zod.coerce.date().nullish(),
  "coordinates": zod.array(zod.number()).optional()
}),zod.null()]).optional()
})
}),zod.null()])
})
export const ListConversationsResponse = zod.array(ListConversationsResponseItem)


/**
 * @summary List messages for a job
 */
export const ListMessagesParams = zod.object({
  "changaId": zod.coerce.number()
})

export const ListMessagesResponseItem = zod.object({
  "id": zod.number(),
  "changaId": zod.number(),
  "emisorId": zod.number(),
  "texto": zod.string(),
  "adjuntos": zod.array(zod.object({
  "objectPath": zod.string(),
  "nombre": zod.string().optional()
})),
  "leido": zod.boolean(),
  "createdAt": zod.string(),
  "emisor": zod.object({
  "id": zod.number(),
  "nombre": zod.string(),
  "email": zod.string(),
  "telefono": zod.string().nullish(),
  "fotoObjectPath": zod.string().nullish(),
  "rol": zod.enum(['cliente', 'profesional', 'admin']),
  "ubicacion": zod.union([zod.object({
  "direccionTexto": zod.string().optional(),
  "ciudad": zod.string().optional(),
  "provincia": zod.string().optional(),
  "zona": zod.string().optional(),
  "capturedAt": zod.coerce.date().nullish(),
  "coordinates": zod.array(zod.number()).optional()
}),zod.null()]).optional()
})
})
export const ListMessagesResponse = zod.array(ListMessagesResponseItem)


/**
 * @summary Send a message
 */
export const CreateMessageParams = zod.object({
  "changaId": zod.coerce.number()
})

export const createMessageBodyTextoMax = 1000;

export const createMessageBodyAdjuntosMax = 5;



export const CreateMessageBody = zod.object({
  "texto": zod.string().min(1).max(createMessageBodyTextoMax),
  "adjuntos": zod.array(zod.object({
  "objectPath": zod.string(),
  "nombre": zod.string().optional()
})).max(createMessageBodyAdjuntosMax).optional()
})

export const CreateMessageResponse = zod.object({
  "id": zod.number(),
  "changaId": zod.number(),
  "emisorId": zod.number(),
  "texto": zod.string(),
  "adjuntos": zod.array(zod.object({
  "objectPath": zod.string(),
  "nombre": zod.string().optional()
})),
  "leido": zod.boolean(),
  "createdAt": zod.string(),
  "emisor": zod.object({
  "id": zod.number(),
  "nombre": zod.string(),
  "email": zod.string(),
  "telefono": zod.string().nullish(),
  "fotoObjectPath": zod.string().nullish(),
  "rol": zod.enum(['cliente', 'profesional', 'admin']),
  "ubicacion": zod.union([zod.object({
  "direccionTexto": zod.string().optional(),
  "ciudad": zod.string().optional(),
  "provincia": zod.string().optional(),
  "zona": zod.string().optional(),
  "capturedAt": zod.coerce.date().nullish(),
  "coordinates": zod.array(zod.number()).optional()
}),zod.null()]).optional()
})
})


/**
 * @summary Mark the other participant's messages as read
 */
export const MarkMessagesReadParams = zod.object({
  "changaId": zod.coerce.number()
})

export const MarkMessagesReadResponse = zod.void()


/**
 * @summary List appointments for a conversation
 */
export const ListAppointmentsParams = zod.object({
  "changaId": zod.coerce.number()
})

export const ListAppointmentsResponseItem = zod.object({
  "id": zod.number(),
  "changaId": zod.number(),
  "clienteId": zod.number(),
  "profesionalId": zod.number(),
  "empiezaAt": zod.coerce.date(),
  "terminaAt": zod.coerce.date().nullable(),
  "estado": zod.enum(['solicitada', 'confirmada', 'en_curso', 'completada', 'cancelada']),
  "createdAt": zod.coerce.date(),
  "updatedAt": zod.coerce.date()
})
export const ListAppointmentsResponse = zod.array(ListAppointmentsResponseItem)


/**
 * @summary Propose an appointment in a conversation
 */
export const ProposeAppointmentParams = zod.object({
  "changaId": zod.coerce.number()
})

export const ProposeAppointmentBody = zod.object({
  "empiezaAt": zod.coerce.date(),
  "terminaAt": zod.coerce.date().nullish()
})

export const ProposeAppointmentResponse = zod.object({
  "id": zod.number(),
  "changaId": zod.number(),
  "clienteId": zod.number(),
  "profesionalId": zod.number(),
  "empiezaAt": zod.coerce.date(),
  "terminaAt": zod.coerce.date().nullable(),
  "estado": zod.enum(['solicitada', 'confirmada', 'en_curso', 'completada', 'cancelada']),
  "createdAt": zod.coerce.date(),
  "updatedAt": zod.coerce.date()
})


/**
 * @summary List coordination attempts for a conversation
 */
export const ListAppointmentAttemptsParams = zod.object({
  "changaId": zod.coerce.number()
})

export const ListAppointmentAttemptsResponseItem = zod.object({
  "id": zod.number(),
  "changaId": zod.number(),
  "accion": zod.enum(['proponer', 'aceptar', 'rechazar', 'cancelar']),
  "resultado": zod.enum(['exitoso', 'rechazado', 'error_permiso', 'error_validacion', 'error_red']),
  "detalle": zod.string().nullable(),
  "appointmentId": zod.number().nullable(),
  "empiezaAt": zod.coerce.date().nullable(),
  "createdAt": zod.coerce.date()
})
export const ListAppointmentAttemptsResponse = zod.array(ListAppointmentAttemptsResponseItem)


/**
 * @summary Log a coordination attempt outcome
 */
export const LogAppointmentAttemptParams = zod.object({
  "changaId": zod.coerce.number()
})

export const logAppointmentAttemptBodyDetalleMax = 500;



export const LogAppointmentAttemptBody = zod.object({
  "accion": zod.enum(['proponer', 'aceptar', 'rechazar', 'cancelar']),
  "resultado": zod.enum(['error_permiso', 'error_validacion', 'error_red']),
  "detalle": zod.string().max(logAppointmentAttemptBodyDetalleMax).optional()
})

export const LogAppointmentAttemptResponse = zod.object({
  "id": zod.number(),
  "changaId": zod.number(),
  "accion": zod.enum(['proponer', 'aceptar', 'rechazar', 'cancelar']),
  "resultado": zod.enum(['exitoso', 'rechazado', 'error_permiso', 'error_validacion', 'error_red']),
  "detalle": zod.string().nullable(),
  "appointmentId": zod.number().nullable(),
  "empiezaAt": zod.coerce.date().nullable(),
  "createdAt": zod.coerce.date()
})


/**
 * @summary Accept an appointment
 */
export const AcceptAppointmentParams = zod.object({
  "id": zod.coerce.number()
})

export const AcceptAppointmentResponse = zod.object({
  "id": zod.number(),
  "changaId": zod.number(),
  "clienteId": zod.number(),
  "profesionalId": zod.number(),
  "empiezaAt": zod.coerce.date(),
  "terminaAt": zod.coerce.date().nullable(),
  "estado": zod.enum(['solicitada', 'confirmada', 'en_curso', 'completada', 'cancelada']),
  "createdAt": zod.coerce.date(),
  "updatedAt": zod.coerce.date()
})


/**
 * @summary Reject an appointment
 */
export const RejectAppointmentParams = zod.object({
  "id": zod.coerce.number()
})

export const RejectAppointmentResponse = zod.object({
  "id": zod.number(),
  "changaId": zod.number(),
  "clienteId": zod.number(),
  "profesionalId": zod.number(),
  "empiezaAt": zod.coerce.date(),
  "terminaAt": zod.coerce.date().nullable(),
  "estado": zod.enum(['solicitada', 'confirmada', 'en_curso', 'completada', 'cancelada']),
  "createdAt": zod.coerce.date(),
  "updatedAt": zod.coerce.date()
})


