import { createApp } from './app.js';
const { app } = await createApp();
const port = Number(process.env.PORT || 4173);
app.listen(port, '0.0.0.0', () => console.log(`Darker listening on port ${port}`));
