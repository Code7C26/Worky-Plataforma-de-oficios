import bcrypt from "bcryptjs";
import { db, professionalProfiles, users, serviceCatalog } from "@workspace/db";

const passwordHash = await bcrypt.hash("123456", 12);
const seedUsers = [
  { nombre: "Roberto Giménez", email: "roberto@worky.test", rol: "profesional" as const, telefono: "3515550101", ubicacion: { direccionTexto: "Alta Gracia", coordinates: [-64.428, -31.652] } },
  { nombre: "Sofía López", email: "sofia@worky.test", rol: "profesional" as const, telefono: "3515550102", ubicacion: { direccionTexto: "Córdoba", coordinates: [-64.188, -31.42] } },
  { nombre: "Diego Paz", email: "diego@worky.test", rol: "profesional" as const, telefono: "3515550103", ubicacion: { direccionTexto: "Alta Gracia", coordinates: [-64.428, -31.652] } },
  { nombre: "Marcela Sosa", email: "marcela@worky.test", rol: "cliente" as const, telefono: "3515550104", ubicacion: { direccionTexto: "Alta Gracia", coordinates: [-64.428, -31.652] } },
  { nombre: "Administración Worky", email: "admin@worky.test", rol: "admin" as const, telefono: null, ubicacion: null },
];
for (const item of seedUsers) {
  const [user] = await db.insert(users).values({ ...item, passwordHash }).onConflictDoUpdate({ target: users.email, set: { nombre: item.nombre, rol: item.rol, passwordHash } }).returning();
  if (item.rol === "profesional") {
    const data = item.email.startsWith("roberto") ? { oficio: "Gasista matriculado", categoria: "Gas" as const, precioReferencia: "15000", experienciaAnios: 6, rating: "4.9", skills: ["Matrícula habilitante", "Instalaciones de gas", "Reparaciones"], about: "Gasista matriculado con más de 6 años de experiencia en instalaciones domiciliarias y reparaciones de urgencia." } : item.email.startsWith("sofia") ? { oficio: "Electricista", categoria: "Electricidad" as const, precioReferencia: "12000", experienciaAnios: 5, rating: "4.7", skills: ["Tableros", "Iluminación", "Urgencias"], about: "Instalaciones seguras, mantenimiento y soluciones eléctricas para tu hogar." } : { oficio: "Plomero", categoria: "Plomería" as const, precioReferencia: "11000", experienciaAnios: 8, rating: "4.8", skills: ["Pérdidas", "Desagües", "Baños"], about: "Reparaciones de agua y desagües con atención rápida y presupuesto claro." };
    await db.insert(professionalProfiles).values({ usuarioId: user.id, ...data, verificado: true, estadoVerificacion: "verified", disponible: true, cantidadChangas: 0 }).onConflictDoUpdate({ target: professionalProfiles.usuarioId, set: { ...data, verificado: true, estadoVerificacion: "verified", updatedAt: new Date() } });
  }
}
const catalog = [
  ["Plomería", "Pérdidas y grifería"], ["Plomería", "Desagües"], ["Electricidad", "Tableros e iluminación"],
  ["Gas", "Instalaciones matriculadas"], ["Albañilería", "Reparaciones"], ["Otro", "Mantenimiento general"],
];
for (const [categoria, especialidad] of catalog) {
  await db.insert(serviceCatalog).values({ categoria, especialidad }).onConflictDoNothing();
}
console.log("Worky seed completado.");
process.exit(0);