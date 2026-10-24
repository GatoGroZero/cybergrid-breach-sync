import { z } from 'zod';

// La politica de contenido no permite eval. Zod prueba `new Function` al crear sus esquemas y
// Firefox deja un aviso en la consola aunque el intento falle, asi que se desactiva desde el inicio.
// Este archivo debe importarse antes que cualquier modulo que cree esquemas.
z.config({ jitless: true });
