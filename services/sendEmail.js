const nodemailer = require('nodemailer');

const sendVerificationEmail = async (email, token) => {
  const transporter = nodemailer.createTransport({
    service: 'gmail', // Cambia esto a tu servicio de correo
    auth: {
      user: 'your_email@gmail.com', // Tu correo
      pass: 'your_email_password', // Tu contraseña
    },
  });

  const verificationUrl = `http://localhost:3000/auth/verify-email/${token}`;

  const mailOptions = {
    from: 'your_email@gmail.com',
    to: email,
    subject: 'Email Verification',
    text: `Please verify your email by clicking on the link: ${verificationUrl}`,
  };

  await transporter.sendMail(mailOptions);
};

module.exports = { sendVerificationEmail };
