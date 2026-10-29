declare module 'connect-pg-simple' {
  const connectPgSimple: (session: typeof import('express-session')) => new (options: { pool: import('pg').Pool; createTableIfMissing?: boolean }) => import('express-session').Store;
  export default connectPgSimple;
}
