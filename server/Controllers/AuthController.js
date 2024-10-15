import User from "../Models/User.js";
import OTP from "../Models/Otp.js";
import PasswordReset from "../Models/PasswordReset.js";
import cryptojs from "crypto-js";
import bcrypt from "bcrypt";
import cloudinary from "cloudinary";
import jwt from "jsonwebtoken";
import { uploadToCloudinary } from "../Middleware/uploadImg.js";

import sendMail from "../utils/mailSender.js";
import forgotPasswordTemplate from "../MailTemplates/forgotPassword.js";
import otpTemplate from "../MailTemplates/otpTemplate.js";

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
});

const signup = async (req, res) => {
    try {
        const { firstName, lastName, userBio, userEmail, userName, userPassword } = req.body;

        if (!userEmail.endsWith("@gmail.com")) {
            return res.status(400).json({ error: "Invalid email domain. Must be @gmail.com" });
        }
                

        if (userPassword.length < 8) {
            return res.status(400).json({ error: "Password must be at least 8 characters long" });
        }

        const existingUser = await User.findOne({ userEmail });
        if (existingUser) {
            return res.status(401).json({ error: "User Already Exists with this email" });
        }

        // console.log(req.body);
        // console.log(req.file);

        console.log("Starting image upload to Cloudinary");
        const localFilePath = req.file.path
        const originalname = req.file.originalname
        const result = await uploadToCloudinary(localFilePath, originalname);
        console.log(result);

        const saltRounds = 10;
        const encryptedPassword = await bcrypt.hash(userPassword, saltRounds);

        console.log('1');

        const newUser = await User.create({
            firstName,
            lastName,
            userBio,
            userEmail,
            userName,
            userPassword: encryptedPassword,
            profileImage: result.secure_url,
        });

        const token = jwt.sign(
            { userId: newUser._id, userEmail: newUser.userEmail },
            process.env.JWT_SECRET,
            { expiresIn: "1h" }
        );

        return res.status(200).json({
            status: "Ok",
            user: newUser,
            token: token
        });

    } catch (error) {
        console.log(error);
        console.error("Error in signup:", error);
        res.status(500).json({ error: error.message });
    }
};


// Login Route
const login = async (req, res) => {
    try {
        const { userEmail, userPassword } = req.body;

        const user = await User.findOne({ userEmail });
        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }

        const passwordMatch = await bcrypt.compare(userPassword, user.userPassword);
        if (!passwordMatch) {
            return res.status(401).json({ error: "Invalid credentials" });
        }

        const token = jwt.sign(
            { userId: user._id, userEmail: user.userEmail },
            process.env.JWT_SECRET,
            { expiresIn: "1h" }
        );

        res.status(200).json({
            status: "Ok",
            user: user,
            token: token,
        });
    } catch (error) {
        res.status(400).json({ error: error.message });
        console.log(error);
    }
};

// Forgot password route
const forgotPassword = async (req, res) => {
    try {
        const { email } = req.body;
        console.log(email);
        if (email.length === 0) {
            return res.status(400).json({ error: "Email is required" });
        }
        const user = await User.findOne({ userEmail: email.trim().toLowerCase() });
        console.log(user);
        if (!user) {
            return res.status(404).json({ error: "User with this email not found" });
        }

        const resetToken = cryptojs.lib.WordArray.random(32).toString();
        const createdAt = Date.now();

        const passwordResetEntry = new PasswordReset({
            userId: user._id,
            token: resetToken,
            createdAt: createdAt,
        });

        await passwordResetEntry.save();

        const resetUrl = `${process.env.FRONTEND_URL}/reset-password/${resetToken}`;
        const htmlContent = forgotPasswordTemplate(user.firstName, resetUrl);

        await sendMail(user.userEmail, 'Reset Your Password and Get Back Into Your Notorite Account', htmlContent);

        res.status(200).json({ status: "Ok", message: "Check your email for the reset link" });
    } catch (error) {
        res.status(400).json({ error: error.message });
        console.log(error);
    }
};

// Reset password route
const resetPassword = async (req, res) => {
    try {
        const { token } = req.params;
        const { newPassword } = req.body;

        const passwordResetEntry = await PasswordReset.findOne({ token });
        if (!passwordResetEntry) {
            return res.status(400).json({ error: "Token is invalid or has expired" });
        }

        const user = await User.findById(passwordResetEntry.userId);
        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }

        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(newPassword, saltRounds);

        user.userPassword = hashedPassword;
        await user.save();

        await PasswordReset.deleteOne({ _id: passwordResetEntry._id });

        res.status(200).json({ message: "Password reset successful" });
    } catch (error) {
        res.status(500).json({ error: error.message });
        console.log(error);
    }
};

const sendOtp = async (req, res) => {
    try {
        const { userEmail } = req.body;
        const otp = Math.floor(100000 + Math.random() * 900000).toString();

        // Deleting existing OTP for the email
        await OTP.findOneAndDelete({ userEmail });

        const newOtp = new OTP({ userEmail, otp, createdAt: Date.now() });
        await newOtp.save();

        const htmlContent = otpTemplate(userEmail, otp);
        await sendMail(userEmail, "Verify your email address for Notorite", htmlContent);

        res.status(200).json({ status: "Ok", message: "OTP sent successfully" });
    } catch (error) {
        res.status(500).json({ error: error.message });
        console.log(error);
    };
};

const verifyOtp = async (req, res) => {
    try {
        const { userEmail, otp } = req.body;
        const existingOtp = await OTP.findOne({ userEmail });

        if (!existingOtp) {
            return res.status(404).json({ error: "OTP not found. Please request a new OTP" });
        }

        if (existingOtp.otp !== otp) {
            return res.status(401).json({ error: "Invalid OTP" });
        }

        await OTP.deleteOne({ userEmail });

        res.status(200).json({ status: "Ok", message: "OTP verified successfully" });
    } catch (error) {
        res.status(500).json({ error: error.message });
        console.log(error);
    }
};

export default { signup, login, forgotPassword, resetPassword, sendOtp, verifyOtp };